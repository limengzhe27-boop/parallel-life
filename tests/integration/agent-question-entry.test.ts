import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { registerHooks } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { TaskSchema } from '../../src/contracts/api.ts';
import {
  emptyActorAgentState,
  type ActorAgentState,
  type AgentProposal,
} from '../../src/modules/world/domain/agent-runtime.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
  PostgresAgentRuntimeRepository,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { PostgresGroupRepository } from '../../src/modules/world/infrastructure/group-repository.ts';
import { nativeAgentCommandId } from '../../src/modules/world/infrastructure/agent-native-ids.ts';

type Payload = {
  promptVersion: string;
  state: ActorAgentState;
  input: { sourceId: string; text: string };
  channel: { kind: string; threadId: string };
};
const response = (text: string, extra: Partial<AgentProposal> = {}): AgentProposal => ({
  statements: [{ text, dependsOnActionIds: [] }],
  goals: [],
  plans: [],
  actions: [],
  responsibilities: [],
  decisions: [],
  ...extra,
});
const serverCondition = process.execArgv.includes('--conditions=react-server');
if (!serverCondition && process.env.PL_QUESTION_ENTRY_CHILD !== '1') {
  test('question entry assertions execute in a real isolated react-server child', async (t) => {
    const env: NodeJS.ProcessEnv = { ...process.env, PL_QUESTION_ENTRY_CHILD: '1' };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(
      process.execPath,
      [
        '--conditions=react-server',
        '--experimental-strip-types',
        '--test',
        '--test-reporter=tap',
        fileURLToPath(import.meta.url),
      ],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
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
      child.once('close', (code) => resolve(code ?? 1));
    });
    t.diagnostic(output.trim());
    assert.equal(code, 0, 'actual child assertions must pass');
    assert.ok(
      Number(/# tests (\d+)/.exec(output)?.[1]) >= 6,
      'all five real entry groups must execute',
    );
    assert.match(output, /# fail 0\b/);
    assert.match(output, /# skipped 0\b/);
  });
} else {
  test('real PG and native HTTP question lifecycle, controlled model outputs and no network forwarding', async (t) => {
    assert.ok(serverCondition);
    const cfg = await localConfig();
    assert.equal(cfg.port, Number(process.env.AGENT_QUESTION_ENTRY_TEST_PORT ?? 55565));
    const admin = await adminClient('parallel_life_test');
    await migrate(admin);
    const savedEnv = { ...process.env },
      savedFetch = globalThis.fetch;
    const dir = await mkdtemp(path.join(tmpdir(), 'parallel-life-question-entry-'));
    const owned: { owner: string; id: string }[] = [];
    let svc: ReturnType<typeof import('../../src/server/services.ts').getServices> | undefined;
    const hooks = registerHooks({
      resolve(specifier, context, next) {
        return next(specifier === 'next/server' ? 'next/server.js' : specifier, context);
      },
    });
    t.after(async () => {
      try {
        for (const f of owned)
          await admin.query(
            'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=$1 AND owner_id=$2',
            [f.id, f.owner],
          );
      } finally {
        try {
          await svc?.db.close();
          await admin.end();
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
      'WORKER_DATABASE_URL',
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
    const origin = 'http://127.0.0.1:34443';
    Object.assign(process.env, {
      APP_DATABASE_URL: `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
      WORKER_DATABASE_URL: `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
      SESSION_SECRET: 'q'.repeat(64),
      APP_ORIGIN: origin,
      PRIVATE_ASSET_DIR: dir,
      YIBU_API_KEY: 'synthetic-question-entry-no-network',
      YIBU_BASE_URL: 'https://yibuapi.com',
      YIBU_TEXT_MODEL: 'synthetic-question-entry',
    });
    const requests: Payload[] = [];
    let gatewayCalls = 0;
    let reply: ((payload: Payload) => AgentProposal) | undefined;
    globalThis.fetch = async (input, init) => {
      gatewayCalls++;
      assert.equal(String(input), 'https://yibuapi.com/v1/chat/completions');
      assert.ok(reply, 'unexpected request; never forwarded');
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(
        body.messages.find((m: { role: string }) => m.role === 'user').content,
      ) as Payload;
      assert.match(payload.promptVersion, /^npc-agent-/, 'no extra director model call');
      requests.push(payload);
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify(reply(payload)) }, finish_reason: 'stop' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const { getServices } = await import('../../src/server/services.ts');
    svc = getServices();
    const services = svc;
    const { POST: runTask } = await import('../../src/app/api/v1/tasks/[id]/run/route.ts');
    const groups = new PostgresGroupRepository(services.db),
      states = new PostgresAgentRuntimeRepository(services.db);
    function run(owner: string, id: string) {
      const payload = `${owner}.${Math.floor(Date.now() / 1000) + 3600}`;
      const token = `${payload}.${createHmac('sha256', 'q'.repeat(64))
        .update('session:' + payload)
        .digest('base64url')}`;
      assert.equal(services.sessions.verify(token), owner);
      return runTask(
        new Request(`${origin}/api/v1/tasks/${id}/run`, {
          method: 'POST',
          headers: {
            Origin: origin,
            Cookie: `pl_session=${token}`,
            'X-CSRF-Token': services.sessions.csrf(token),
            'Content-Type': 'application/json',
          },
          body: '{}',
        }),
        { params: Promise.resolve({ id }) },
      );
    }
    async function fixture(invitation = false) {
      const owner = services.sessions.issue().userId,
        id = randomUUID(),
        a = randomUUID(),
        b = randomUUID();
      await services.identity.ensureGuest(owner);
      const world: WorldState = {
        schemaVersion: 1,
        id,
        ownerId: owner,
        version: 0,
        title: 'Local question regression',
        time: new Date().toISOString(),
        actors: [
          { id: a, name: 'A', persona: 'Independent A' },
          { id: b, name: 'B', persona: 'Independent B' },
        ],
        facts: invitation
          ? [
              {
                id: 'basis',
                text: 'A wants to invite the player for dinner.',
                kind: 'canonical',
                visibility: { kind: 'actors', actorIds: [a] },
                sourceEventId: 'genesis:' + id,
              },
            ]
          : [],
        messages: [],
        appointments: [],
        mediaRequests: [],
      };
      await services.worlds.initialize({ userId: owner }, world);
      owned.push({ owner, id });
      await services.db.transaction(owner, async (sql) => {
        for (const actor of world.actors) {
          const state = emptyActorAgentState(
            { worldId: id, actorId: actor.id },
            agentDefinitionRef(world, actor.id),
            0,
          );
          if (invitation && actor.id === a) {
            state.goals = [
              {
                id: 'goal',
                summary: 'Invite for dinner',
                status: 'active',
                sourceIds: ['fact:basis'],
                resultIds: [],
              },
            ];
            state.plans = [
              {
                id: 'plan',
                goalId: 'goal',
                summary: 'Propose dinner',
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
                capability: 'appointment.propose',
                status: 'ready',
                sourceIds: ['fact:basis'],
                targetIds: [],
                parameters: {
                  title: 'Dinner',
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
          expectedWorldVersion: 0,
        });
      });
      const group = await groups.create(owner, {
        worldId: id,
        commandId: randomUUID(),
        expectedVersion: 0,
        title: 'Question group',
        actorIds: [a, b],
      });
      return { owner, id, a, b, groupId: group.groupId };
    }
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    const read = (f: Fixture, actor = f.a) =>
      states.read(f.owner, { worldId: f.id, actorId: actor });
    const question = (payload: Payload) => {
      const q = payload.state.questions?.find(
        (q) =>
          q.status === 'open' &&
          q.channel === payload.channel.kind &&
          q.threadId === payload.channel.threadId,
      );
      assert.ok(q, 'real authorized pending question must reach the NPC');
      return q;
    };
    async function groupTurn(f: Fixture, text: string, make: (p: Payload) => AgentProposal) {
      const world = await services.worlds.get({ userId: f.owner }, f.id);
      const sent = await groups.send(f.owner, {
        worldId: f.id,
        groupId: f.groupId,
        commandId: randomUUID(),
        expectedVersion: world.version,
        text,
      });
      const before = requests.length,
        callsBefore = gatewayCalls;
      reply = make;
      try {
        const http = await run(f.owner, sent.task.id);
        assert.equal(http.status, 200);
        assert.equal(
          gatewayCalls - callsBefore,
          1,
          'one NPC call total, including rejected gateway attempts',
        );
        return {
          sent,
          task: TaskSchema.parse(await http.json()),
          payloads: requests.slice(before),
        };
      } finally {
        reply = undefined;
      }
    }
    async function privateTurn(f: Fixture, text: string, make: (p: Payload) => AgentProposal) {
      const world = await services.worlds.get({ userId: f.owner }, f.id),
        before = requests.length,
        callsBefore = gatewayCalls;
      reply = make;
      try {
        const result = await services.npcAgents.sendMessageIfEnabled(f.owner, {
          id: randomUUID(),
          worldId: f.id,
          expectedVersion: world.version,
          actorId: f.a,
          text,
        });
        assert.equal(result?.status, 'committed');
        assert.equal(
          gatewayCalls - callsBefore,
          1,
          'one private NPC call, no serial director request',
        );
        return requests.slice(before);
      } finally {
        reply = undefined;
      }
    }
    const ask = (text: string, extra: Partial<AgentProposal> = {}) =>
      response(text, {
        statements: [{ text, dependsOnActionIds: [], requestsPlayerReply: true }],
        ...extra,
      });
    async function runtimeEvent(f: Fixture, taskId: string) {
      return services.db.transaction(f.owner, async (sql) => {
        const row = (
          await sql.query(
            `SELECT a.actor_id,a.input_receipt_id,a.response,e.id,e.payload,c.status AS command_status
        FROM parallel_life.agent_attempts a JOIN parallel_life.world_events e ON e.world_id=a.world_id AND e.owner_id=a.owner_id AND e.id=a.event_id
        JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.result_event_id=e.id
        WHERE a.world_id=$1 AND a.owner_id=$2 AND a.command_id=ANY($3::text[])`,
            [f.id, f.owner, [f.a, f.b].map((actor) => nativeAgentCommandId(taskId, actor))],
          )
        ).rows[0];
        return row;
      });
    }

    await t.test(
      'A actual question survives B interjection and an unmentioned short answer routes to A in one call',
      async () => {
        const f = await fixture();
        const a = await groupTurn(f, '@A ask me', () => ask('Which drink?'));
        assert.equal(a.task.status, 'succeeded');
        const before = (await read(f))!;
        assert.equal(before.questions?.length, 1);
        const q = before.questions![0]!;
        const messages = await groups.read(f.owner, f.id, f.groupId);
        assert.ok(
          messages.messages.some(
            (m) =>
              `group:${m.id}` === q.sourceId &&
              m.sender.kind === 'actor' &&
              m.sender.actorId === f.a,
          ),
        );
        const b = await groupTurn(f, '@B comment', () => response('Nice weather.'));
        assert.equal(b.task.status, 'succeeded');
        assert.deepEqual((await read(f))!.questions, before.questions);
        const bState = await read(f, f.b);
        const answered = await groupTurn(f, 'Tea', (p) =>
          response('Tea it is.', {
            replyAssessments: [
              {
                questionId: question(p).id,
                sourceId: p.input.sourceId,
                quote: 'Tea',
                relation: 'answer',
              },
            ],
          }),
        );
        assert.equal(answered.task.status, 'succeeded');
        assert.equal(answered.payloads.length, 1);
        assert.equal(answered.payloads[0]!.state.actorId, f.a);
        assert.deepEqual(await read(f, f.b), bState);
        const after = (await read(f))!;
        assert.equal(after.questions![0]!.status, 'answered');
        assert.equal(after.questions![0]!.resolution!.quote, 'Tea');
        assert.equal(after.questions![0]!.sourceId, q.sourceId);
        assert.equal(after.questions![0]!.text, q.text);
        assert.equal(
          after.questions![0]!.resolution!.sourceId,
          answered.payloads[0]!.input.sourceId,
        );
        const row = await runtimeEvent(f, answered.sent.task.id);
        assert.ok(row, 'actual native attempt/event/command must be linked');
        assert.equal(row.actor_id, f.a);
        assert.equal(row.command_status, 'succeeded');
        assert.equal(row.payload.data.agentRuntime.stateAfter.questions[0].status, 'answered');
        assert.equal(row.payload.data.agentRuntime.questionChanges[0].relation, 'answer');
      },
    );
    await t.test(
      'unrelated weather and defer answer preserve the same pending question',
      async () => {
        const f = await fixture();
        assert.equal((await groupTurn(f, '@A ask', () => ask('Dinner?'))).task.status, 'succeeded');
        const initial = (await read(f))!.questions![0]!;
        for (const [text, relation] of [
          ['Nice weather', 'unrelated'],
          ['Later', 'defer_answer'],
        ] as const) {
          const turn = await groupTurn(f, '@A ' + text, (p) =>
            response('Understood.', {
              replyAssessments: [
                { questionId: question(p).id, sourceId: p.input.sourceId, quote: text, relation },
              ],
            }),
          );
          assert.equal(turn.task.status, 'succeeded');
          assert.equal(turn.payloads.length, 1);
          assert.deepEqual((await read(f))!.questions![0], initial);
          const row = await runtimeEvent(f, turn.sent.task.id);
          assert.equal(row.payload.data.agentRuntime.questionChanges[0].statusAfter, 'open');
        }
      },
    );
    await t.test(
      'answering a question linked to an actual invitation cannot fulfill the waiting responsibility',
      async () => {
        const f = await fixture(true);
        await privateTurn(f, 'Propose the dinner.', (p) =>
          response('Here is an invitation.', {
            actions: [{ ...p.state.actions.find((a) => a.id === 'action')!, status: 'proposed' }],
          }),
        );
        const initial = (await read(f))!,
          responsibility = initial.responsibilities.find((r) => r.subject.kind === 'appointment');
        assert.ok(responsibility);
        await privateTurn(f, 'Ask whether I can come.', () =>
          ask('Can you come?', {
            statements: [
              {
                text: 'Can you come?',
                dependsOnActionIds: [],
                requestsPlayerReply: true,
                questionForResponsibilityId: responsibility.id,
              },
            ],
          }),
        );
        const payloads = await privateTurn(f, 'Yes', (p) =>
          response('Thanks.', {
            replyAssessments: [
              {
                questionId: question(p).id,
                sourceId: p.input.sourceId,
                quote: 'Yes',
                relation: 'answer',
              },
            ],
          }),
        );
        assert.equal(payloads.length, 1);
        const final = (await read(f))!;
        assert.equal(
          final.questions!.find((q) => q.responsibilityId === responsibility.id)!.status,
          'answered',
        );
        assert.deepEqual(final.responsibilities, initial.responsibilities);
        assert.equal(final.responsibilities[0]!.status, 'waiting');
        const world = await services.worlds.get({ userId: f.owner }, f.id);
        assert.equal(world.appointments[0]!.status, 'proposed');
        assert.ok(final.goals.every((g) => g.status !== 'fulfilled'));
        assert.equal(final.decisions.length, 0);
        assert.equal(
          Number(
            (
              await admin.query(
                "SELECT count(*) AS n FROM parallel_life.agent_action_results WHERE world_id=$1 AND document->'handledResponsibilityIds' <> '[]'::jsonb",
                [f.id],
              )
            ).rows[0].n,
          ),
          0,
        );
      },
    );
    await t.test(
      'private and group questions coexist without putting private question text in group model payloads',
      async () => {
        const f = await fixture(),
          secret = 'PRIVATE_QUESTION_SENTINEL_44_43';
        await privateTurn(f, 'Ask privately.', () => ask(secret + ' will you answer?'));
        const privateQ = (await read(f))!.questions!.find((q) => q.channel === 'private')!;
        const group = await groupTurn(f, '@A ask publicly', () => ask('Public drink question?'));
        assert.equal(group.task.status, 'succeeded');
        assert.ok(
          !JSON.stringify(group.payloads).includes(secret),
          'entire group model payload must exclude private transcript, including state.questions',
        );
        const both = (await read(f))!.questions!;
        assert.equal(both.length, 2);
        assert.deepEqual(
          both.find((q) => q.id === privateQ.id),
          privateQ,
        );
        const answered = await groupTurn(f, 'Tea', (p) =>
          response('Tea.', {
            replyAssessments: [
              {
                questionId: question(p).id,
                sourceId: p.input.sourceId,
                quote: 'Tea',
                relation: 'answer',
              },
            ],
          }),
        );
        assert.equal(answered.task.status, 'succeeded');
        assert.ok(!JSON.stringify(answered.payloads).includes(secret));
        assert.deepEqual(
          (await read(f))!.questions!.find((q) => q.id === privateQ.id),
          privateQ,
        );
        await privateTurn(f, 'I can answer now.', (p) =>
          response('Thanks.', {
            replyAssessments: [
              {
                questionId: question(p).id,
                sourceId: p.input.sourceId,
                quote: 'I can answer now.',
                relation: 'answer',
              },
            ],
          }),
        );
        assert.equal((await read(f))!.questions!.filter((q) => q.status === 'answered').length, 2);
      },
    );
    await t.test(
      'an invented quote rolls back NPC output and a successful task replay adds no question or model request',
      async () => {
        const f = await fixture();
        const initial = await groupTurn(f, '@A ask', () => ask('Which drink?'));
        assert.equal(initial.task.status, 'succeeded');
        const before = (await read(f))!,
          messages = (await groups.read(f.owner, f.id, f.groupId)).messages.length;
        const invalid = await groupTurn(f, '@A Tea', (p) =>
          response('Should never appear.', {
            replyAssessments: [
              {
                questionId: question(p).id,
                sourceId: p.input.sourceId,
                quote: 'Coffee',
                relation: 'answer',
              },
            ],
          }),
        );
        assert.equal(invalid.task.status, 'failed');
        assert.equal(invalid.task.errorCode, 'INVALID_AI_OUTPUT');
        assert.deepEqual(await read(f), before);
        assert.equal(
          (await groups.read(f.owner, f.id, f.groupId)).messages.length,
          messages + 1,
          'only the actual player input persists',
        );
        const calls = gatewayCalls,
          after = await read(f);
        const replay = await run(f.owner, initial.sent.task.id);
        assert.equal(replay.status, 200);
        assert.equal(TaskSchema.parse(await replay.json()).status, 'succeeded');
        assert.equal(gatewayCalls, calls);
        assert.deepEqual(await read(f), after);
      },
    );
  });
}
