import { randomUUID } from 'node:crypto';
import { BuildInputSchema } from '../../../contracts/world-build.ts';
import { ApprovedSeedSchema } from '../../../contracts/seeds.ts';
import type { TaskLease } from '../../tasks/domain/types.ts';
import type { PostgresTaskQueue } from '../../tasks/infrastructure/postgres-task-queue.ts';
import type { WorldState } from '../domain/types.ts';
import { openingMessageAt } from '../domain/opening-time.ts';
import { genesisMessages } from '../domain/genesis-messages.ts';
import { WorldPlanner } from './world-planner.ts';

export function buildHandler(queue: PostgresTaskQueue, planner: WorldPlanner, model: string) {
  return async (lease: TaskLease, signal: AbortSignal) => {
    const input = BuildInputSchema.parse(lease.input),
      started = Date.now();
    if (input.seedId !== lease.scopeId) throw Error('INVALID_SCOPE');
    const seed = await queue.read(lease, async (sql) => {
      const row = (
        await sql.query(
          'SELECT s.document FROM parallel_life.approved_seeds s JOIN parallel_life.world_builds b ON b.seed_id=s.id WHERE s.id=$1 AND b.world_id=$2 AND b.opening IS NULL',
          [input.seedId, input.worldId],
        )
      ).rows[0];
      if (!row) throw Error('INVALID_BUILD');
      return ApprovedSeedSchema.parse(row.document);
    });
    const time = new Date().toISOString();
    const opening = await planner.propose(seed, signal, time).catch((error) => {
        /* Surface which model/prompt produced unusable output so the failure is diagnosable. */
        throw Object.assign(error instanceof Error ? error : Error('INVALID_WORLD_OUTPUT'), {
          model,
          promptVersion: planner.promptVersion,
          durationMs: Date.now() - started,
        });
      }),
      sourceEventId = `genesis:${input.worldId}`;
    // Enforce the mapping at the write boundary, independently of model validation.
    if ('personRoles' in seed) {
      const linked = opening.actors.filter((a) => a.sourcePersonId);
      const selected = new Set(seed.people.map((p) => p.id));
      if (
        selected.size !== seed.people.length ||
        linked.length !== selected.size ||
        new Set(linked.map((a) => a.sourcePersonId)).size !== selected.size ||
        linked.some((a) => !selected.has(a.sourcePersonId!))
      )
        throw Error('INVALID_PERSON_MAPPING');
      for (const actor of linked) {
        const person = seed.people.find((p) => p.id === actor.sourcePersonId)!;
        actor.name = person.name;
        const role = seed.personRoles?.find((r) => r.personId === person.id)?.role;
        if (role) actor.relationship = role;
      }
    } else if (opening.actors.some((a) => a.sourcePersonId))
      throw Error('UNEXPECTED_PERSON_MAPPING');
    signal.throwIfAborted();
    const ids = new Map(opening.actors.map((a) => [a.key, randomUUID()]));
    const state: WorldState = {
      schemaVersion: 1,
      id: input.worldId,
      ownerId: lease.ownerId,
      version: 0,
      title: seed.story.title,
      time,
      ...(planner.historyEnabled !== false
        ? { messageHistory: { version: 1 as const, startAt: time, timeZone: 'UTC+08:00' } }
        : {}),
      actors: opening.actors.map((a) => ({
        id: ids.get(a.key)!,
        ...(a.sourcePersonId ? { sourcePersonId: a.sourcePersonId } : {}),
        name: a.name,
        relationship: a.relationship,
        persona: a.persona,
      })),
      actorTies: (opening.actorTies ?? []).map((tie) => ({
        fromActorId: ids.get(tie.fromKey)!,
        toActorId: ids.get(tie.toKey)!,
        relationship: tie.relationship,
        mayShare: tie.mayShare,
      })),
      facts: [
        {
          id: randomUUID(),
          text: `【主角身份】${opening.identity}`,
          visibility: { kind: 'world' },
          sourceEventId,
        },
        {
          id: randomUUID(),
          text: `【世界情境】${opening.setting}`,
          visibility: { kind: 'world' },
          sourceEventId,
        },
      ],
      messages:
        planner.historyEnabled !== false
          ? genesisMessages({
              worldId: input.worldId,
              startAt: time,
              actors: ids,
              history: opening.messageHistory,
              current: opening.messages,
              newId: randomUUID,
            })
          : opening.messages.map((m, index) => ({
              id: randomUUID(),
              actorId: ids.get(m.actorKey)!,
              role: 'assistant' as const,
              text: m.text,
              at: openingMessageAt(time, index, opening.messages.length),
              sourceEventId,
            })),
      appointments: [],
      mediaRequests: [],
    };
    // Derived from the approved source selection, never from model-generated public claims.
    opening.playerActors = state.actors.flatMap((actor) => {
      const person = seed.people.find((person) => person.id === actor.sourcePersonId);
      if (!person || !('personRoles' in seed)) return [];
      const role = seed.personRoles?.find((role) => role.personId === person.id)?.role;
      return [
        {
          actorId: actor.id,
          source: { kind: 'selected_person' as const, personId: person.id },
          relationship: role ?? person.relationship,
        },
      ];
    });
    const initialMediaId = randomUUID();
    const initialMediaPrompt = `${seed.story.title} 角色身份写真：${opening.identity}，写实电影人文质感，35mm胶片，肖像底模图生图，自然光影`;
    const initialMediaTitle = `【身份写真】${opening.identity.slice(0, 24)} · 肖像`;

    const lifestyleMediaId = randomUUID();
    const lifestyleMediaPrompt = `${seed.story.title} 工作与生活纪实：${opening.identity}，现场艺术光影，生活抓拍，肖像底模图生图`;
    const lifestyleMediaTitle = `【身份写真】${opening.identity.slice(0, 24)} · 现场`;

    if (seed.portraitAssetId) {
      state.mediaRequests.push(
        {
          id: initialMediaId,
          prompt: initialMediaPrompt,
          status: 'pending',
          sourceEventId,
        },
        {
          id: lifestyleMediaId,
          prompt: lifestyleMediaPrompt,
          status: 'pending',
          sourceEventId,
        },
      );
    }
    signal.throwIfAborted();
    await queue.commit(lease, async (sql) => {
      const row = (
        await sql.query(
          'SELECT opening FROM parallel_life.world_builds WHERE seed_id=$1 AND world_id=$2 FOR UPDATE',
          [input.seedId, input.worldId],
        )
      ).rows[0];
      if (!row || row.opening) throw Error('INVALID_BUILD');
      await sql.query(
        'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
        [state.id, lease.ownerId, state.title, { ...state, messages: [] }],
      );
      if ('personRoles' in seed) {
        for (const actor of opening.actors.filter((a) => a.sourcePersonId)) {
          const person = seed.people.find((p) => p.id === actor.sourcePersonId);
          if (!person) throw Error('INVALID_PERSON_MAPPING');
          const revision = person.assetId
            ? seed.assets.find((a) => a.assetId === person.assetId)?.revision
            : null;
          if (person.assetId) {
            const asset = (
              await sql.query(
                "SELECT id FROM parallel_life.assets WHERE id=$1 AND owner_id=$2 AND revision=$3 AND status='ready' AND origin='upload' AND world_id IS NULL FOR SHARE",
                [person.assetId, lease.ownerId, revision],
              )
            ).rows[0];
            if (!asset) throw Error('INVALID_PERSON_ASSET');
          }
          await sql.query(
            'INSERT INTO parallel_life.world_person_bindings(world_id,owner_id,person_id,actor_id,person_snapshot,asset_id,asset_revision) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [
              state.id,
              lease.ownerId,
              person.id,
              ids.get(actor.key),
              person,
              person.assetId,
              revision,
            ],
          );
        }
      }
      if (seed.portraitAssetId) {
        const mediaItems = [
          { id: initialMediaId, prompt: initialMediaPrompt, title: initialMediaTitle },
          { id: lifestyleMediaId, prompt: lifestyleMediaPrompt, title: lifestyleMediaTitle },
        ];
        for (const item of mediaItems) {
          await sql.query(
            'INSERT INTO parallel_life.world_media_requests(id,world_id,owner_id,document) VALUES($1,$2,$3,$4)',
            [
              item.id,
              state.id,
              lease.ownerId,
              {
                id: item.id,
                worldId: state.id,
                prompt: item.prompt,
                referenceAssetId: seed.portraitAssetId,
                title: item.title,
                sourceEventId,
                status: 'pending',
                createdAt: time,
              },
            ],
          );
          await sql.query(
            'INSERT INTO parallel_life.outbox_jobs(id,world_id,owner_id,event_id,payload) VALUES($1,$2,$3,$4,$5)',
            [
              `genesis_${item.id}`,
              state.id,
              lease.ownerId,
              sourceEventId,
              {
                id: `genesis_${item.id}`,
                eventId: sourceEventId,
                worldId: state.id,
                type: 'image.generate',
                requestId: item.id,
                prompt: item.prompt,
                referenceAssetId: seed.portraitAssetId,
                title: item.title,
              },
            ],
          );
        }
      }
      await sql.query(
        'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,$3,$4)',
        [state.id, lease.ownerId, state, seed],
      );
      await sql.query('UPDATE parallel_life.world_builds SET opening=$2 WHERE seed_id=$1', [
        input.seedId,
        opening,
      ]);
      return {
        value: undefined,
        outcome: {
          status: 'succeeded',
          resultVersion: 0,
          model,
          promptVersion: planner.promptVersion,
          durationMs: Date.now() - started,
        },
      };
    });
  };
}
