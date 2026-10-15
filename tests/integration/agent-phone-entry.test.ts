import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { registerHooks } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import {
  PostgresDatabase,
  type SqlClient,
} from '../../src/modules/storage/infrastructure/postgres.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import { OpeningAdvanceSchema } from '../../src/contracts/publication-opening.ts';
import { AdvanceReceiptSchema, type AdvanceReceipt } from '../../src/contracts/world-clock.ts';

const serverCondition = process.execArgv.includes('--conditions=react-server');
if (!serverCondition && process.env.PL_AGENT_PHONE_ENTRY_CHILD !== '1') {
  test('phone entry HTTP assertions run in an isolated real react-server process', async (t) => {
    const childEnv: NodeJS.ProcessEnv = { ...process.env, PL_AGENT_PHONE_ENTRY_CHILD: '1' };
    // Node's inherited runner marker would otherwise suppress all nested test files.
    delete childEnv.NODE_TEST_CONTEXT;
    const child = spawn(
      process.execPath,
      [
        '--conditions=react-server',
        '--experimental-strip-types',
        '--test',
        '--test-reporter=tap',
        fileURLToPath(import.meta.url),
      ],
      {
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (value) => resolve(value ?? 1));
    });
    t.diagnostic(output.trim());
    assert.equal(
      code,
      0,
      'actual react-server child assertions must all pass; see retained output',
    );
    const count = /# tests (\d+)/.exec(output);
    assert(
      count && Number(count[1]) >= 6,
      'the child must actually execute its database assertions',
    );
    assert.match(output, /# fail 0\b/);
    assert.match(output, /# skipped 0\b/);
  });
} else {
  test('real phone opening and advance entrypoints use one runtime, with isolated local configuration and no network forwarding', async (t) => {
    assert(serverCondition, 'the child must have the real react-server condition');
    const { readNpcAgentOpeningStatusIfEnabled } =
      await import('../../src/server/npc-agent-advance-services.ts');
    const { PublicationRepository } =
      await import('../../src/modules/settings/infrastructure/publication-repository.ts');
    const { PublicationWorldRepository } =
      await import('../../src/modules/settings/infrastructure/publication-world-repository.ts');
    const { compilePublicationGenesis } =
      await import('../../src/modules/settings/infrastructure/publication-genesis.ts');
    const cfg = await localConfig();
    assert.equal(cfg.port, Number(process.env.AGENT_PHONE_ENTRY_TEST_PORT ?? 55565));
    const admin = await adminClient('parallel_life_test');
    await migrate(admin);
    const savedEnv = { ...process.env },
      savedFetch = globalThis.fetch;
    const dir = await mkdtemp(path.join(tmpdir(), 'parallel-life-phone-entry-'));
    const worldsOwned: { owner: string; id: string }[] = [];
    let services: ReturnType<typeof import('../../src/server/services.ts').getServices> | undefined;
    let publisherDb: PostgresDatabase | undefined;
    // Test-only exact Node resolution compatibility. It loads the real NextResponse implementation.
    const hooks = registerHooks({
      resolve(specifier, context, nextResolve) {
        return nextResolve(specifier === 'next/server' ? 'next/server.js' : specifier, context);
      },
    });
    t.after(async () => {
      try {
        for (const f of worldsOwned)
          await admin.query(
            `INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now,paused)
           SELECT id,owner_id,(state->>'time')::timestamptz,true FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2
           ON CONFLICT(world_id) DO UPDATE SET paused=true,active_until=NULL`,
            [f.id, f.owner],
          );
      } finally {
        try {
          await Promise.all([services?.db.close(), publisherDb?.close(), admin.end()]);
        } finally {
          globalThis.fetch = savedFetch;
          hooks.deregister();
          for (const key of Object.keys(process.env)) delete process.env[key];
          Object.assign(process.env, savedEnv);
          await rm(dir, { recursive: true, force: true });
        }
      }
    });
    for (const key of [
      'APP_DATABASE_URL',
      'DATABASE_URL',
      'SESSION_SECRET',
      'APP_ORIGIN',
      'PRIVATE_ASSET_DIR',
      'BLOB_READ_WRITE_TOKEN',
      'BLOB_STORE_ID',
      'SUPABASE_URL',
      'SUPABASE_SECRET_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_STORAGE_BUCKET',
      'VERCEL',
      'APP_PREVIEW_ONLY',
      'YIBU_API_KEY',
      'YIBU_BASE_URL',
      'YIBU_TEXT_MODEL',
    ])
      delete process.env[key];
    const { getServices } = await import('../../src/server/services.ts');
    assert.throws(() => getServices(), /SERVER_NOT_CONFIGURED/);
    Object.assign(process.env, {
      APP_DATABASE_URL: `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
      SESSION_SECRET: 's'.repeat(64),
      APP_ORIGIN: 'http://127.0.0.1:34441',
    });
    assert.throws(() => getServices(), /PRIVATE_STORAGE_NOT_CONFIGURED/);
    Object.assign(process.env, {
      PRIVATE_ASSET_DIR: dir,
      YIBU_API_KEY: 'synthetic-phone-entry-no-network',
      YIBU_BASE_URL: 'https://yibuapi.com',
      YIBU_TEXT_MODEL: 'synthetic-phone-entry',
    });
    let gatewayCalls = 0,
      mode: 'forbid' | 'quiet_action' = 'forbid';
    globalThis.fetch = async (input, init) => {
      gatewayCalls++;
      assert.equal(String(input), 'https://yibuapi.com/v1/chat/completions');
      assert.equal(mode, 'quiet_action', 'unexpected gateway call; no request is ever forwarded');
      const body = JSON.parse(String(init?.body)),
        payload = JSON.parse(
          body.messages.find((m: { role: string }) => m.role === 'user').content,
        );
      assert.match(payload.promptVersion, /^npc-agent-/);
      const action = {
        ...payload.state.actions.find((a: { status: string }) => a.status === 'ready'),
        status: 'proposed',
      };
      assert(action.id);
      const plan = payload.state.plans.find(
        (p: { id: string; actionIds: string[] }) =>
          p.id === action.parameters.planId || p.actionIds.includes(action.id),
      );
      assert(plan);
      const proposal = {
        statements: [],
        goals: [],
        plans: [plan],
        actions: [action],
        responsibilities: [],
        decisions: [],
      };
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(proposal) }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    services = getServices();
    const svc = services;
    const { publicationOpeningRoute } =
      await import('../../src/server/publication-opening-http.ts');
    const { POST: advancePost } = await import('../../src/app/api/v1/worlds/[id]/advance/route.ts');
    const origin = 'http://127.0.0.1:34441';
    function request(owner: string, method: string, body?: unknown) {
      const payload = `${owner}.${Math.floor(Date.now() / 1000) + 3600}`;
      const token = `${payload}.${createHmac('sha256', 's'.repeat(64))
        .update('session:' + payload)
        .digest('base64url')}`;
      assert.equal(svc.sessions.verify(token), owner);
      return new Request(origin + '/api/v1/worlds/opening', {
        method,
        headers: {
          Origin: origin,
          Cookie: `pl_session=${token}`,
          'X-CSRF-Token': svc.sessions.csrf(token),
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    async function switchRuntime(
      owner: string,
      id: string,
      world: WorldState,
      capability?: 'plan.record' | 'appointment.propose',
    ) {
      await svc.db.transaction(owner, async (sql) => {
        for (const actor of world.actors) {
          const state = emptyActorAgentState(
            { worldId: id, actorId: actor.id },
            agentDefinitionRef(world, actor.id),
            world.version,
          );
          if (capability && actor.id === world.actors[0]!.id) {
            state.goals = [
              {
                id: 'goal',
                summary: '安排自己的事情',
                status: 'active',
                sourceIds: ['fact:basis'],
                resultIds: [],
              },
            ];
            state.plans = [
              {
                id: 'plan',
                goalId: 'goal',
                summary: '按自己的安排继续',
                status: 'active',
                sourceIds: ['fact:basis'],
                actionIds: ['action'],
                nextActionId: 'action',
                triggers: [],
                missingConditions: [],
              },
            ];
            state.actions = [
              {
                id: 'action',
                goalId: 'goal',
                capability,
                status: 'ready',
                sourceIds: ['fact:basis'],
                targetIds: [],
                parameters:
                  capability === 'plan.record'
                    ? { planId: 'plan' }
                    : {
                        title: '自己的后续安排',
                        at: new Date(Date.parse(world.time) + 3600000).toISOString(),
                      },
                preconditions: [],
                dependsOnActionIds: [],
                handlesResponsibilityIds: [],
              },
            ];
          }
          await initializeActorAgentStateInTransaction(sql, owner, state);
        }
        await switchAgentEngineEpochInTransaction(sql, owner, {
          worldId: id,
          expectedEpoch: 1,
          nextEpoch: 2,
          expectedWorldVersion: world.version,
        });
      });
    }
    async function fixture(epoch: 1 | 2 = 2, capability?: 'plan.record' | 'appointment.propose') {
      const issued = svc.sessions.issue(),
        owner = issued.userId,
        id = randomUUID(),
        actor = randomUUID();
      await svc.identity.ensureGuest(owner);
      const world: WorldState = {
        schemaVersion: 1,
        id,
        ownerId: owner,
        version: 0,
        title: 'Synthetic phone entry',
        time: new Date().toISOString(),
        actors: [{ id: actor, name: '甲', persona: '有独立计划。' }],
        facts: capability
          ? [
              {
                id: 'basis',
                text: '本人有自己的安排。',
                kind: 'canonical',
                visibility: { kind: 'actors', actorIds: [actor] },
                sourceEventId: 'genesis:' + id,
              },
            ]
          : [],
        messages: [],
        appointments: [],
        mediaRequests: [],
      };
      await svc.worlds.initialize({ userId: owner }, world);
      worldsOwned.push({ owner, id });
      if (epoch === 2) await switchRuntime(owner, id, world, capability);
      return { owner, id, actor, world };
    }
    const tables = [
      'world_events',
      'commands',
      'world_messages',
      'publication_story_plans',
      'publication_story_nodes',
      'publication_opening_batches',
      'publication_opening_deliveries',
      'agent_attempts',
      'director_runtime_attempts',
    ];
    async function counts(id: string) {
      const result: Record<string, number> = {};
      for (const table of tables)
        result[table] = Number(
          (
            await admin.query(`SELECT count(*) n FROM parallel_life.${table} WHERE world_id=$1`, [
              id,
            ])
          ).rows[0].n,
        );
      return result;
    }

    await t.test(
      'read helper is genuinely read-only, epoch-1 returns null, and epoch-2 with no source routes as agents/none',
      async () => {
        const old = await fixture(1),
          f = await fixture();
        const before = await counts(f.id);
        assert.equal(await readNpcAgentOpeningStatusIfEnabled(svc.db, old.owner, old.id), null);
        assert.deepEqual(await readNpcAgentOpeningStatusIfEnabled(svc.db, f.owner, f.id), {
          runtime: 'agents',
          phase: 'none',
          total: 0,
          delivered: 0,
          retryable: false,
        });
        assert.deepEqual(await counts(f.id), before);
        assert.equal(gatewayCalls, 0);
        await assert.rejects(readNpcAgentOpeningStatusIfEnabled(svc.db, old.owner, f.id), {
          code: 'NOT_FOUND',
        });
      },
    );
    await t.test(
      'real opening GET/POST and main advance HTTP plus story service bypass every old engine for an epoch-2 quiet world',
      async () => {
        const f = await fixture(),
          before = await counts(f.id);
        const get = await publicationOpeningRoute(request(f.owner, 'GET'), f.id);
        assert.equal(get.status, 200);
        assert.equal((await get.json()).runtime, 'agents');
        const post = await publicationOpeningRoute(request(f.owner, 'POST', {}), f.id);
        assert.equal(post.status, 200);
        const opening = OpeningAdvanceSchema.parse(await post.json());
        assert.equal(opening.played, 0);
        assert.equal(opening.opening.phase, 'none');
        const main = await advancePost(request(f.owner, 'POST', { automatic: true }), {
          params: Promise.resolve({ id: f.id }),
        });
        assert.equal(main.status, 200);
        assert.equal(AdvanceReceiptSchema.parse(await main.json()).played, 0);
        assert.equal((await svc.advanceStoryOnly(f.owner, f.id)).played, 0);
        await assert.rejects(svc.advanceStoryOnly(f.owner, f.id, false, randomUUID()), {
          code: 'INVALID_COMMAND',
        });
        const retry = await publicationOpeningRoute(
          request(f.owner, 'POST', { confirmRetry: true }),
          f.id,
        );
        assert.equal(retry.status, 422);
        const forged = request(f.owner, 'GET');
        forged.headers.set('cookie', 'pl_session=invalid');
        assert.equal((await publicationOpeningRoute(forged, f.id)).status, 401);
        const noCsrf = request(f.owner, 'POST', {});
        noCsrf.headers.delete('x-csrf-token');
        assert.equal((await publicationOpeningRoute(noCsrf, f.id)).status, 401);
        assert.deepEqual(await counts(f.id), before);
        assert.equal(gatewayCalls, 0);
      },
    );

    await t.test(
      'an actually bound authored opening remains unplanned without creating the old story plan or delivery batch',
      async () => {
        // All creation is a synthetic local trial, using the existing publisher role; no grants added.
        class LocalPublisher extends PostgresDatabase {
          override transaction<T>(owner: string, run: (sql: SqlClient) => Promise<T>) {
            return super.transaction(owner, async (sql) => {
              await sql.query('SET LOCAL ROLE pl_publisher');
              return run(sql);
            });
          }
        }
        publisherDb = new LocalPublisher(
          `postgresql://pl_admin:${cfg.adminPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
        );
        const staff = randomUUID();
        await admin.query(
          'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
          [staff, 'Synthetic phone trial writer'],
        );
        const raw = await readFile(
          new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
          'utf8',
        );
        const content = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]!);
        content.candidates = [
          {
            key: 'start',
            kind: 'candidate',
            title: '尚未发生的开场',
            editorialIntent: '由导演审定后再安排。',
            script: '仅合成原稿，不是已发生事实。',
            actorKeys: content.actors.map((a: { key: string }) => a.key),
            prerequisites: [],
            mutuallyExclusiveNodeKeys: [],
            intent: { kind: 'director_event' },
          },
        ];
        content.openingEventKey = 'start';
        delete content.timeline;
        delete content.conditions;
        const works = new PublicationRepository(publisherDb),
          work = await works.create(staff, {
            commandId: randomUUID(),
            title: 'Synthetic phone pending opening',
            content,
          });
        const repository = new PublicationWorldRepository(publisherDb, {
          prepare(input) {
            const result = compilePublicationGenesis({
              ...input,
              originKind: 'trial',
              newId: randomUUID,
            });
            assert.equal(result.status, 'compiled');
            if (result.status !== 'compiled') throw Error('SYNTHETIC_TRIAL_COMPILE_FAILED');
            return {
              world: result.world,
              opening: result.opening,
              seed: {
                id: input.seedId,
                createdAt: new Date().toISOString(),
                source: { kind: 'publication_trial', ...input.origin },
                identity: result.opening.identity,
                situation: result.opening.situation,
                setting: result.opening.setting,
                experienceNote: result.opening.experienceNote,
              },
            };
          },
        });
        const created = await repository.startTrial(staff, work.id, {
          commandId: randomUUID(),
          draftVersion: 0,
          contentHash: (await works.get(staff, work.id)).draft.contentHash,
        });
        const session = await repository.trialSession(staff, created.trialId!),
          world = await svc.worlds.get({ userId: session.ownerId }, session.worldId);
        worldsOwned.push({ owner: session.ownerId, id: session.worldId });
        await switchRuntime(session.ownerId, session.worldId, world);
        await admin.query('UPDATE parallel_life.world_clock SET paused=true WHERE world_id=$1', [
          session.worldId,
        ]);
        const before = await counts(session.worldId);
        assert.equal(before.publication_story_plans, 0);
        assert.equal(before.publication_opening_batches, 0);
        const status = await readNpcAgentOpeningStatusIfEnabled(
          svc.db,
          session.ownerId,
          session.worldId,
        );
        assert.equal(status!.runtime, 'agents');
        assert.equal(status!.phase, 'unplanned');
        assert.equal(status!.delivered, 0);
        const response = await publicationOpeningRoute(
          request(session.ownerId, 'GET'),
          session.worldId,
        );
        assert.equal(response.status, 200);
        assert.equal((await response.json()).phase, 'unplanned');
        const post = await publicationOpeningRoute(
          request(session.ownerId, 'POST', {}),
          session.worldId,
        );
        assert.equal(post.status, 200);
        assert.equal((await post.json()).opening.phase, 'unplanned');
        assert.deepEqual(await counts(session.worldId), before);
        assert.equal(gatewayCalls, 0);
      },
    );
    for (const capability of ['plan.record', 'appointment.propose'] as const)
      await t.test(
        `quiet ${capability} committed through actual services returns changed/worldVersion without played messages`,
        async () => {
          const f = await fixture(2, capability),
            before = await svc.worlds.get({ userId: f.owner }, f.id),
            calls = gatewayCalls;
          mode = 'quiet_action';
          try {
            let result: AdvanceReceipt;
            if (capability === 'plan.record') {
              const response = await publicationOpeningRoute(request(f.owner, 'POST', {}), f.id);
              assert.equal(response.status, 200);
              const { opening, ...advance } = OpeningAdvanceSchema.parse(await response.json());
              assert.equal(opening.runtime, 'agents');
              result = advance;
            } else {
              result = AdvanceReceiptSchema.parse({
                status: 'advanced',
                worldId: f.id,
                ...(await svc.advanceStoryOnly(f.owner, f.id)),
              });
            }
            assert.equal(result.changed, true);
            assert.equal(result.worldVersion, before.version + 1);
            assert.equal(result.played, 0);
            assert.deepEqual(result.actors, []);
            assert.equal(gatewayCalls, calls + 1);
            const after = await svc.worlds.get({ userId: f.owner }, f.id);
            assert.equal(after.version, result.worldVersion);
            assert.equal(after.messages.length, 0);
            if (capability === 'appointment.propose') assert.equal(after.appointments.length, 1);
          } finally {
            mode = 'forbid';
          }
        },
      );
  });
}
