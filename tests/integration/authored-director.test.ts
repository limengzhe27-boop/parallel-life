import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import {
  PostgresDatabase,
  type SqlClient,
} from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PublicationRepository } from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublicationWorldRepository } from '../../src/modules/settings/infrastructure/publication-world-repository.ts';
import { publicationWorldCompiler } from '../../src/server/publication-runtime.ts';
import {
  PublishedWorldContentSchema,
  inspectPublishedWorldSupport,
} from '../../src/contracts/published-world-content.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import {
  PostgresDirectorRuntimeRepository,
  directorSnapshotInputHash,
  directorCoordinationFrameHash,
} from '../../src/modules/world/infrastructure/director-runtime-repository.ts';
import {
  WorldDirectorAgentModel,
  parseDirectorDecision,
} from '../../src/modules/world/infrastructure/director-agent-model.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { authoredDirectorSourceHandle } from '../../src/modules/world/domain/authored-agent-material.ts';
import { readAuthoredAgentMaterialCatalog } from '../../src/modules/world/infrastructure/authored-agent-material-repository.ts';
import { runDirectorAgent } from '../../src/modules/world/application/run-director-agent.ts';
import type {
  DirectorSnapshot,
  DirectorAttempt,
  DirectorDecision,
} from '../../src/modules/world/domain/director-runtime.ts';

test('actual bound author source -> director snapshot -> explicit mock model -> protected SQL75 proposed episode', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.AUTHORED_DIRECTOR_TEST_PORT ?? 55566));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  class LocalPublisher extends PostgresDatabase {
    override transaction<T>(owner: string, run: (sql: SqlClient) => Promise<T>) {
      return super.transaction(owner, async (sql) => {
        await sql.query('SET LOCAL ROLE pl_publisher');
        return run(sql);
      });
    }
  }
  const pub = new LocalPublisher(
    `postgresql://pl_admin:${cfg.adminPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const owned: { owner: string; id: string }[] = [];
  const localWorks: { staff: string; id: string }[] = [];
  t.after(async () => {
    try {
      for (const f of owned)
        await admin.query(
          'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=$1 AND owner_id=$2',
          [f.id, f.owner],
        );
      for (const f of localWorks) {
        const row = (
          await admin.query(
            'SELECT listed,metadata_version FROM parallel_life.publication_works WHERE id=$1',
            [f.id],
          )
        ).rows[0];
        if (row?.listed)
          await works.unpublish(f.staff, f.id, {
            commandId: randomUUID(),
            expectedMetadataVersion: Number(row.metadata_version),
          });
      }
    } finally {
      await app.close();
      await pub.close();
      await admin.end();
    }
  });
  const staff = randomUUID();
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
    [staff, 'Explicit local authored director fixture'],
  );
  const receiptId = randomUUID();
  const works = new PublicationRepository(pub, {
    async review({ content }) {
      return {
        reviewerVersion: 'EXPLICIT_LOCAL_FIXTURE_NOT_AI',
        runtimeCapabilities: new Set(inspectPublishedWorldSupport(content).requiredCapabilities),
        media: { verified: true, manifestHash: 'a'.repeat(64) },
        trial: { verified: true, receiptId },
      };
    },
  });
  const trials = new PublicationWorldRepository(pub, publicationWorldCompiler),
    published = new PublicationWorldRepository(app, publicationWorldCompiler),
    worlds = new PostgresWorldRepository(app),
    snapshots = new PostgresDirectorSnapshotRepository(app),
    store = new PostgresDirectorRuntimeRepository(app);
  const raw = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const base = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]!);
  base.world.startAt = '2026-10-12T09:00:00.000Z';
  base.history = [];
  base.initialKnowledge = [];
  base.protagonist.knownFactKeys = [];
  base.phone = { messages: [], moments: [], notes: [], invitations: [], album: [] };
  delete base.timeline;
  delete base.conditions;
  const script =
    '  合成作者原稿\n这里写的是预期方向与参考台词，尚未发生。\n' + '完整原文不裁剪。'.repeat(80);
  base.candidates = ['opening', 'later'].map((key) => ({
    key,
    kind: 'candidate',
    title: '原始标题' + key,
    editorialIntent: '  原始编导概览  ' + key,
    script: script + key,
    actorKeys: base.actors.map((a: { key: string }) => a.key),
    settingPlaceKey: base.world.startPlaceKey,
    prerequisites: [],
    mutuallyExclusiveNodeKeys: [],
    intent: { kind: 'director_event' },
  }));
  base.openingEventKey = 'opening';
  const content = PublishedWorldContentSchema.parse(base);
  async function workWith(c = content) {
    const work = await works.create(staff, {
      commandId: randomUUID(),
      title: 'Local director source fixture',
      content: c,
    });
    localWorks.push({ staff, id: work.id });
    return work;
  }
  async function migrateWorld(owner: string, id: string) {
    owned.push({ owner, id });
    const state = await worlds.get({ userId: owner }, id);
    await app.transaction(owner, async (sql) => {
      for (const a of state.actors)
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState({ worldId: id, actorId: a.id }, agentDefinitionRef(state, a.id), 0),
        );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId: id,
        expectedWorldVersion: 0,
        expectedEpoch: 1,
        nextEpoch: 2,
      });
    });
    return { owner, id };
  }
  async function trialFixture(c = content) {
    const work = await workWith(c),
      draft = (await works.get(staff, work.id)).draft;
    const trial = await trials.startTrial(staff, work.id, {
        commandId: randomUUID(),
        draftVersion: 0,
        contentHash: draft.contentHash,
      }),
      session = await trials.trialSession(staff, trial.trialId!);
    return { ...(await migrateWorld(session.ownerId, session.worldId)), work };
  }
  const read = (f: { owner: string; id: string }) =>
    snapshots.read(f.owner, {
      worldId: f.id,
      engineEpoch: 2,
      worldVersion: 0,
      candidates: [],
      blockers: [],
    });
  function claim(s: DirectorSnapshot): Omit<DirectorAttempt, 'status' | 'decisionId'> {
    return {
      id: randomUUID(),
      worldId: s.worldId,
      commandId: randomUUID(),
      engineEpoch: 2,
      expectedWorldVersion: 0,
      inputHash: directorSnapshotInputHash(s),
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };
  }
  function output(s: DirectorSnapshot) {
    const m = s.authoredMaterials!.materials[0]!,
      handle = authoredDirectorSourceHandle(m);
    return {
      mode: 'bounded_opportunity',
      selectedCandidateIds: [],
      deferred: [],
      nudges: [],
      opportunities: [
        {
          id: randomUUID(),
          title: '待考虑的作者机会',
          description: '导演草案，尚未发生',
          playerImpact: '可选择参与',
          participantActorIds: [s.boundary.actorIds[0]!],
          placeIds: [s.boundary.placeIds[0]!],
          activity: 'conversation',
          authoredEventKey: m.ref.nodeKey,
          basisSourceIds: [handle],
        },
      ],
      audit: { reason: '仅供导演审计', basisSourceIds: [handle] },
    };
  }
  async function counts(f: { id: string }) {
    const out: Record<string, number> = {};
    for (const table of [
      'world_events',
      'world_messages',
      'world_facts',
      'agent_attempts',
      'agent_input_receipts',
      'publication_story_plans',
      'publication_story_nodes',
      'publication_story_progress',
      'director_runtime_attempts',
      'director_decisions',
      'shared_episodes',
    ])
      out[table] = Number(
        (
          await admin.query(
            `SELECT count(*)::int n FROM parallel_life.${table} WHERE world_id=$1`,
            [f.id],
          )
        ).rows[0].n,
      );
    return out;
  }
  async function states(f: { id: string }) {
    return (
      await admin.query(
        'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 ORDER BY actor_id',
        [f.id],
      )
    ).rows;
  }
  async function paid(f: { owner: string; id: string }, s: DirectorSnapshot, raw: unknown) {
    let a = (await store.claim(f.owner, claim(s), s)).attempt;
    a = await store.mark(f.owner, a, 'request_sent');
    return store.saveResponse(f.owner, a, JSON.stringify(raw));
  }
  await t.test(
    'actual trial RR read is write-free and preserves complete authored text and real mappings',
    async () => {
      const f = await trialFixture(),
        before = await counts(f),
        snapshot = await read(f);
      assert.deepEqual(await counts(f), before);
      assert.equal(snapshot.authoredMaterials!.source!.origin.publicationVersion, 0);
      assert.equal(snapshot.authoredMaterials!.materials[0]!.node.script, script + 'opening');
      assert.deepEqual(
        snapshot.authoredMaterials!.materials[0]!.participantRefs.map((a) => a.actorId).sort(),
        snapshot.boundary.actorIds.slice().sort(),
      );
      assert.deepEqual(snapshot.candidates, []);
      assert.equal(before.publication_story_plans, 0);
    },
  );
  await t.test(
    'real snapshot, explicit mock model, parser, claim/save/commit and proposed episode retain immutable author trace',
    async () => {
      const f = await trialFixture(),
        s = await read(f),
        before = await counts(f),
        actors = await states(f),
        raw = output(s);
      let calls = 0,
        payload: any;
      const model = new WorldDirectorAgentModel({
        async complete(messages) {
          calls++;
          payload = JSON.parse(messages[1]!.content);
          return JSON.stringify(raw);
        },
      });
      const input = claim(s),
        d = await runDirectorAgent(
          { attempts: store, model, parse: parseDirectorDecision },
          f.owner,
          input,
          s,
        );
      assert.equal(calls, 1);
      assert.equal(payload.authoredMaterials.materials[0].node.script, script + 'opening');
      assert.equal(payload.authoredMaterials.materials[0].sourceId, raw.audit.basisSourceIds[0]);
      const episodes = await store.readEpisodes(f.owner, f.id);
      assert.equal(episodes.length, 1);
      assert.equal(episodes[0]!.status, 'proposed');
      assert.deepEqual(episodes[0]!.origin, { kind: 'director', sourceId: d.id });
      assert.deepEqual(episodes[0]!.sourceEventIds, []);
      assert.deepEqual(episodes[0]!.resultIds, []);
      const saved = (
        await admin.query(
          'SELECT snapshot,status,response_hash FROM parallel_life.director_runtime_attempts WHERE id=$1',
          [input.id],
        )
      ).rows[0];
      assert.equal(saved.status, 'committed');
      assert.ok(saved.response_hash);
      assert.deepEqual(saved.snapshot.authoredMaterials, s.authoredMaterials);
      assert.equal(
        (await store.readDecision(f.owner, f.id, d.id))!.opportunities[0]!.authoredEventKey,
        saved.snapshot.authoredMaterials.materials[0].ref.nodeKey,
      );
      const after = await counts(f);
      for (const table of Object.keys(before).filter(
        (k) => !['director_runtime_attempts', 'director_decisions', 'shared_episodes'].includes(k),
      ))
        assert.equal(after[table], before[table], table);
      assert.deepEqual(await states(f), actors);
      assert.equal((await worlds.get({ userId: f.owner }, f.id)).version, 0);
      assert.deepEqual(
        await runDirectorAgent(
          { attempts: store, model, parse: parseDirectorDecision },
          f.owner,
          input,
          s,
        ),
        d,
      );
      assert.equal(calls, 1);
    },
  );
  await t.test(
    'published immutable source follows the same actual snapshot and SQL75 proposed-only path',
    async () => {
      const work = await workWith(),
        check = await works.check(staff, work.id, {
          commandId: randomUUID(),
          expectedDraftVersion: 0,
        });
      assert.equal(check.status, 'ready');
      await works.publish(staff, work.id, {
        commandId: randomUUID(),
        expectedDraftVersion: 0,
        expectedMetadataVersion: 0,
        checkId: check.id,
      });
      const owner = randomUUID();
      await new IdentityRepository(app).ensureGuest(owner);
      const created = await published.startPublished(owner, work.id, {
          commandId: randomUUID(),
          publicationVersion: 1,
        }),
        f = await migrateWorld(owner, created.worldId),
        s = await read(f);
      assert.equal(s.authoredMaterials!.source!.origin.publicationVersion, 1);
      const raw = output(s),
        a = await paid(f, s, raw),
        d = parseDirectorDecision(s, raw, a);
      await store.commit(owner, a, s, d);
      assert.equal((await store.readEpisodes(owner, f.id))[0]!.status, 'proposed');
      assert.equal((await counts(f)).world_events, 0);
    },
  );
  await t.test(
    'new bound claim cannot omit, truncate or forge a catalogue/hash before a model request',
    async () => {
      const f = await trialFixture(),
        s = await read(f);
      for (const mutate of [
        (x: DirectorSnapshot) => {
          delete x.authoredMaterials;
        },
        (x: DirectorSnapshot) => {
          x.authoredMaterials!.materials.pop();
        },
        (x: DirectorSnapshot) => {
          x.authoredMaterials!.source!.sourceHash = '0'.repeat(64);
        },
        (x: DirectorSnapshot) => {
          x.authoredMaterials!.materials[0]!.node.script = 'Silently truncated';
        },
      ]) {
        const bad = structuredClone(s);
        mutate(bad);
        await assert.rejects(store.claim(f.owner, claim(bad), bad), {
          code: 'DIRECTOR_AUTHORED_SOURCE_CONFLICT',
        });
      }
      assert.equal((await counts(f)).director_runtime_attempts, 0);
    },
  );
  await t.test(
    'direct store validates authored node key plus own material basis and cast/place without relying on parser',
    async () => {
      const f = await trialFixture(),
        s = await read(f),
        raw = output(s),
        a = await paid(f, s, raw),
        d = parseDirectorDecision(s, raw, a);
      const other = authoredDirectorSourceHandle(s.authoredMaterials!.materials[1]!);
      for (const patch of [
        { authoredEventKey: 'unknown' },
        { basisSourceIds: [other] },
        { basisSourceIds: ['authored:' + '0'.repeat(64)] },
        { participantActorIds: [randomUUID()] },
        { placeIds: ['unknown-place'] },
      ]) {
        const bad = { ...d, opportunities: [{ ...d.opportunities[0]!, ...patch }] };
        await assert.rejects(store.commit(f.owner, a, s, bad as DirectorDecision), {
          code: 'DIRECTOR_OPPORTUNITY_BOUNDARY',
        });
        assert.equal((await counts(f)).shared_episodes, 0);
        assert.equal((await counts(f)).director_decisions, 0);
      }
      await store.commit(f.owner, a, s, d);
      assert.equal((await store.readEpisodes(f.owner, f.id))[0]!.status, 'proposed');
    },
  );
  await t.test(
    'even a trusted forged actor candidate cannot send an author handle through a typed nudge',
    async () => {
      const f = await trialFixture(),
        s = await read(f),
        handle = authoredDirectorSourceHandle(s.authoredMaterials!.materials[0]!);
      s.candidates = [
        {
          id: 'forged-candidate',
          worldId: f.id,
          actorId: s.boundary.actorIds[0]!,
          source: 'authored_event',
          episodeId: 'opening',
          actionId: null,
          resourceIds: [],
          channel: 'private',
          threadId: s.boundary.actorIds[0]!,
          sourceIds: [handle],
          expectedWorldVersion: 0,
          expectedActorRevision: 0,
          priority: 1,
          reason: 'Explicit forged trusted input',
          requiresCoordination: false,
        },
      ];
      const raw = {
        mode: 'coordinate',
        selectedCandidateIds: ['forged-candidate'],
        deferred: [],
        nudges: [
          {
            actorId: s.candidates[0]!.actorId,
            candidateId: 'forged-candidate',
            kind: 'consider_opportunity',
            basisSourceIds: [handle],
          },
        ],
        opportunities: [],
        audit: { reason: 'Private director basis', basisSourceIds: [handle] },
      };
      const a = await paid(f, s, raw);
      assert.throws(() => parseDirectorDecision(s, raw, a), { code: 'INVALID_DIRECTOR_PROPOSAL' });
      const d = {
        schemaVersion: 1,
        id: a.id + ':decision',
        worldId: f.id,
        engineEpoch: 2,
        worldVersion: 0,
        inputHash: a.inputHash,
        evaluatedThroughVersion: 0,
        ...raw,
      } as DirectorDecision;
      await assert.rejects(store.commit(f.owner, a, s, d), {
        code: 'DIRECTOR_NUDGE_SOURCE_FORBIDDEN',
      });
      assert.equal((await counts(f)).shared_episodes, 0);
      await store.mark(f.owner, a, 'invalid_output');
    },
  );
  await t.test(
    'a valid bound full manuscript over the default catalogue budget fails before any attempt or model send',
    async () => {
      const large = structuredClone(content);
      large.candidates = Array.from({ length: 8 }, (_, i) => ({
        ...structuredClone(content.candidates[0]!),
        key: 'large_' + i,
        script: 'x'.repeat(7200),
      }));
      large.openingEventKey = 'large_0';
      const f = await trialFixture(PublishedWorldContentSchema.parse(large));
      const result = await app.transaction(f.owner, (sql) =>
        readAuthoredAgentMaterialCatalog(sql, f.owner, {
          worldId: f.id,
          expectedEngineEpoch: 2,
          expectedWorldVersion: 0,
        }),
      );
      assert.equal(result.status, 'index_only');
      assert.ok(result.requiredBytes > 64000);
      await assert.rejects(read(f), { code: 'DIRECTOR_AUTHORED_MATERIAL_BUDGET' });
      assert.equal((await counts(f)).director_runtime_attempts, 0);
    },
  );
  await t.test(
    'editing live draft never changes an existing bound author source or frame',
    async () => {
      const f = await trialFixture(),
        s = await read(f),
        a = await paid(f, s, output(s)),
        changed = structuredClone(content);
      changed.candidates[0]!.script = 'Only a new revision sees this';
      await works.save(staff, f.work.id, {
        commandId: randomUUID(),
        expectedDraftVersion: 0,
        content: changed,
      });
      const current = await read(f);
      assert.deepEqual(current.authoredMaterials, s.authoredMaterials);
      assert.equal(directorCoordinationFrameHash(current), directorCoordinationFrameHash(s));
      const raw = await store.readCompletion(f.owner, a);
      assert(raw.found);
      if (!raw.found) throw Error('Expected paid raw');
      await store.commit(f.owner, a, s, parseDirectorDecision(s, raw.response, a));
    },
  );
  await t.test(
    'a late actual catalogue mapping change is a known source conflict preserving paid raw, without new decisions',
    async () => {
      const f = await trialFixture(),
        s = await read(f),
        raw = output(s),
        a = await paid(f, s, raw),
        original = (await admin.query('SELECT state FROM parallel_life.worlds WHERE id=$1', [f.id]))
          .rows[0].state;
      // Explicit admin fault fixture: a source mapping changes without a version bump. Never a product operation.
      async function replacePlaces(state: unknown) {
        await admin.query('BEGIN');
        try {
          await admin.query(
            "SELECT set_config('app.agent_engine_epoch','2',true),set_config('app.agent_world_id',$1,true)",
            [f.id],
          );
          await admin.query('UPDATE parallel_life.worlds SET state=$2 WHERE id=$1', [f.id, state]);
          await admin.query('COMMIT');
        } catch (error) {
          await admin.query('ROLLBACK');
          throw error;
        }
      }
      await replacePlaces({ ...original, space: { ...original.space, places: [] } });
      try {
        await assert.rejects(store.commit(f.owner, a, s, parseDirectorDecision(s, raw, a)), {
          code: 'DIRECTOR_AUTHORED_SOURCE_CONFLICT',
        });
        const saved = await store.readCompletion(f.owner, a);
        assert(saved.found);
        assert.equal((await counts(f)).director_runtime_attempts, 1);
        assert.equal((await counts(f)).shared_episodes, 0);
        assert.equal((await store.lookup(f.owner, f.id, a.commandId))!.status, 'response_received');
      } finally {
        await replacePlaces(original);
      }
      await store.mark(f.owner, a, 'stale_discarded');
      assert((await store.readCompletion(f.owner, a)).found);
    },
  );
  await t.test(
    'an unbound existing world retains the old snapshot and accepts quiet without fake author fields',
    async () => {
      const owner = randomUUID(),
        id = randomUUID();
      await new IdentityRepository(app).ensureGuest(owner);
      await worlds.initialize(
        { userId: owner },
        {
          schemaVersion: 1,
          id,
          ownerId: owner,
          version: 0,
          title: 'Unbound fixture',
          time: base.world.startAt,
          actors: [],
          facts: [],
          messages: [],
          appointments: [],
          mediaRequests: [],
        },
      );
      const f = await migrateWorld(owner, id),
        s = await read(f);
      assert.equal(Object.hasOwn(s, 'authoredMaterials'), false);
      const raw = {
          mode: 'quiet',
          selectedCandidateIds: [],
          deferred: [],
          nudges: [],
          opportunities: [],
          audit: { reason: 'No author source', basisSourceIds: [] },
        },
        a = await paid(f, s, raw);
      await store.commit(owner, a, s, parseDirectorDecision(s, raw, a));
      assert.equal((await store.readEpisodes(owner, id)).length, 0);
    },
  );
});
