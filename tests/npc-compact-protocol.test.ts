import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type { AgentValidationContext } from '../src/modules/world/domain/agent-kernel.ts';
import { parseAgentProposal } from '../src/modules/world/infrastructure/agent-proposal-parser.ts';
import { npcResponseFormat } from '../src/modules/world/infrastructure/npc-model-protocol.ts';
function fixture(): AgentValidationContext {
  const state = emptyActorAgentState({ worldId: 'w', actorId: 'a' }, 'def', 0);
  return {
    state,
    viewState: state,
    worldVersion: 0,
    storyAt: '2026-10-20T00:00:00.000Z',
    sources: [
      {
        id: 'input',
        kind: 'accepted_input',
        recordId: 'input',
        worldVersion: 0,
        at: '2026-10-20T00:00:00.000Z',
      },
    ],
    input: { sourceId: 'input', origin: 'player', text: '给我拍张自拍' },
    channel: { kind: 'private', threadId: 'a', allowedCapabilities: ['media.generate_image'] },
  };
}
const speech = [{ text: '等我找个光线好的位置。', dependsOnActionIds: [] }];
test('current ordinary reply has no artificial goals, plans or unchanged state output', () => {
  const c = fixture();
  const p = parseAgentProposal(c, {
    protocol: 'npc-wire-v15',
    statements: speech,
    executions: [],
    changes: null,
  });
  assert.deepEqual(p.goals, []);
  assert.deepEqual(p.plans, []);
  assert.deepEqual(p.actions, []);
  assert.equal(p.continuation, undefined);
  assert.equal(p.focus, undefined);
});
test('current immediate image is a real standalone action, system binds input and IDs', () => {
  const c = fixture();
  const wire = {
    protocol: 'npc-wire-v15',
    statements: speech,
    executions: [
      {
        ref: 'action_1',
        action: {
          capability: 'media.generate_image',
          parameters: { sceneDescription: '本人持手机对镜自拍', purpose: 'portrait' },
        },
      },
    ],
    changes: null,
  };
  const p = parseAgentProposal(c, wire);
  assert.equal(p.actions.length, 1);
  assert.equal(p.actions[0]!.goalId, null);
  assert.deepEqual(p.actions[0]!.sourceIds, ['input']);
  assert.deepEqual(p.goals, []);
  assert.deepEqual(p.plans, []);
  assert.deepEqual(parseAgentProposal(c, wire), p);
  assert.throws(() =>
    parseAgentProposal({ ...c, channel: { ...c.channel, allowedCapabilities: [] } }, wire),
  );
  assert.throws(() =>
    parseAgentProposal(c, { ...wire, executions: [{ ...wire.executions[0], actorId: 'other' }] }),
  );
});
test('current schema only requires four top-level fields and offers planless image', () => {
  const c = fixture();
  const f = npcResponseFormat(c.state, 'forbidden', c);
  assert.equal(f.format, 'json_schema');
  if (f.format !== 'json_schema') return;
  const schema = f.schema as any;
  assert.deepEqual(schema.required, ['protocol', 'statements', 'executions', 'changes']);
  assert.equal(schema.properties.protocol.enum[0], 'npc-wire-v15');
  assert.ok(schema.properties.executions.items.required.includes('ref'));
  assert.ok(schema.properties.executions.items.required.includes('action'));
  assert(!JSON.stringify(schema.properties.executions).includes('goal'));
});
test('missing event decision is not invented when compact reply is used for a required event', () => {
  const c = fixture();
  c.input = {
    sourceId: 'input',
    origin: 'coordination',
    text: JSON.stringify({ type: 'npc_episode_consideration', requestId: 'r', revision: 0 }),
  };
  assert.throws(() =>
    parseAgentProposal(c, {
      protocol: 'npc-wire-v15',
      statements: speech,
      executions: [],
      changes: null,
    }),
  );
  const p = parseAgentProposal(c, {
    protocol: 'npc-wire-v15',
    statements: [],
    executions: [],
    changes: { consideration: { choice: 'quiet', reason: '目前暂不参与', basisSourceIds: [] } },
  });
  assert.equal(p.episodeDecision?.choice, 'quiet');
});
test('required consideration cannot be skipped through nullable changes in provider schema', () => {
  const c = fixture();
  const f = npcResponseFormat(c.state, 'required', c);
  if (f.format !== 'json_schema') throw Error('schema');
  const s = f.schema as any;
  assert.equal(s.properties.changes.type, 'object');
  assert.equal(s.properties.changes.properties.consideration.type, 'object');
});
test('no available tools uses null without a fabricated execution', () => {
  const c = fixture();
  c.channel.allowedCapabilities = [];
  assert.deepEqual(
    parseAgentProposal(c, {
      protocol: 'npc-wire-v15',
      statements: speech,
      executions: null,
      changes: null,
    }).actions,
    [],
  );
});
test('structured sticker-only statement uses stickerId without marker text', () => {
  const c = fixture();
  const p = parseAgentProposal(c, {
    protocol: 'npc-wire-v15',
    statements: [{ text: '', stickerId: 'kun', dependsOnActionIds: [] }],
    executions: [],
    changes: null,
  });
  assert.equal(p.statements.length, 1);
  assert.equal(p.statements[0]!.text, '');
  assert.equal(p.statements[0]!.stickerId, 'kun');
});

test('formal recallLast is a private decision, not a fake chat statement', () => {
  const c = fixture();
  const p = parseAgentProposal(c, {
    protocol: 'npc-wire-v15',
    statements: [],
    executions: [],
    changes: { recallLast: true },
  });
  assert.equal(p.recallLast, true);
  assert.equal(p.statements.length, 0);
  assert.throws(() =>
    parseAgentProposal(
      { ...c, channel: { ...c.channel, kind: 'group' } },
      {
        protocol: 'npc-wire-v15',
        statements: [],
        executions: [],
        changes: { recallLast: true },
      },
    ),
  );
});

test('legacy marker transport normalizes into the structured fields', () => {
  const c = fixture();
  const sticker = parseAgentProposal(c, {
    protocol: 'npc-wire-v15',
    statements: [{ text: '[[sticker:hao]]', dependsOnActionIds: [] }],
    executions: [],
    changes: null,
  });
  assert.equal(sticker.statements[0]!.text, '');
  assert.equal(sticker.statements[0]!.stickerId, 'hao');
  const recall = parseAgentProposal(c, {
    protocol: 'npc-wire-v15',
    statements: [{ text: '[[recall:last]]', dependsOnActionIds: [] }],
    executions: [],
    changes: null,
  });
  assert.equal(recall.recallLast, true);
  assert.equal(recall.statements.length, 0);
});
