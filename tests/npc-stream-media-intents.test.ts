import assert from 'node:assert/strict';
import test from 'node:test';
import { NpcStreamParser } from '../src/modules/world/infrastructure/npc-stream-parser.ts';
import { NPC_WIRE_PROTOCOL } from '../src/modules/world/infrastructure/npc-model-protocol.ts';

const options = {
  channelKind: 'private' as const,
  inputOrigin: 'player' as const,
  existingResponsibilityIds: [],
};
const statements = [{ text: '等我找一下光线。', dependsOnActionIds: [] }];
const executions = [
  {
    ref: 'photo',
    action: {
      capability: 'media.generate_image',
      parameters: [{ name: 'sceneDescription', value: '自拍中有 ] 和 \\" 字符' }],
    },
  },
];
const fields = { protocol: NPC_WIRE_PROTOCOL, statements, executions };

test('media intents emit before the remaining turn, only after complete statements and executions', () => {
  const p = new NpcStreamParser(options);
  const first = p.pushChunk(
    `{"protocol":${JSON.stringify(NPC_WIRE_PROTOCOL)},"statements":[${JSON.stringify(statements[0])}`,
  );
  assert.deepEqual(
    first.map((e) => e.kind),
    ['statement'],
  );
  assert.deepEqual(p.pushChunk('],"executions":['), []);
  assert.deepEqual(p.pushChunk(JSON.stringify(executions[0])), []);
  const intent = p.pushChunk(']');
  assert.deepEqual(intent, [
    { kind: 'execution_intents', protocol: NPC_WIRE_PROTOCOL, executions },
  ]);
  assert.deepEqual(p.pushChunk(',"goals":[],"consideration":null}'), []);
});

test('media prefix supports every protocol/statements/executions field order and one-character chunks', () => {
  const orders = [
    ['protocol', 'statements', 'executions'],
    ['protocol', 'executions', 'statements'],
    ['statements', 'protocol', 'executions'],
    ['statements', 'executions', 'protocol'],
    ['executions', 'protocol', 'statements'],
    ['executions', 'statements', 'protocol'],
  ] as const;
  for (const order of orders) {
    const p = new NpcStreamParser(options);
    const prefix =
      '{' + order.map((k) => `${JSON.stringify(k)}:${JSON.stringify(fields[k])}`).join(',');
    const events = [...prefix].flatMap((char) => p.pushChunk(char));
    assert.equal(events.filter((e) => e.kind === 'statement').length, 1, order.join(','));
    assert.deepEqual(
      events.filter((e) => e.kind === 'execution_intents'),
      [{ kind: 'execution_intents', protocol: NPC_WIRE_PROTOCOL, executions }],
    );
    assert.deepEqual(p.pushChunk(',"goals":[]}'), []);
  }
});

test('unsupported protocol, incomplete or invalid statements never authorize early intents', () => {
  for (const prefix of [
    JSON.stringify({ ...fields, protocol: 'npc-wire-v13' }),
    `{"protocol":${JSON.stringify(NPC_WIRE_PROTOCOL)},"executions":${JSON.stringify(executions)},"statements":[${JSON.stringify(statements[0])}`,
    JSON.stringify({
      protocol: NPC_WIRE_PROTOCOL,
      executions,
      statements: [{ text: 'missing dependencies' }],
    }),
    `{"protocol":${JSON.stringify(NPC_WIRE_PROTOCOL)},"executions":${JSON.stringify(executions)},"statements":[${JSON.stringify(statements[0])},]}`,
  ]) {
    const p = new NpcStreamParser(options);
    assert.equal(
      p.pushChunk(prefix).some((e) => e.kind === 'execution_intents'),
      false,
    );
  }
});

test('duplicate protocol/executions/statements fail closed, with no replacement or second dispatch', () => {
  for (const key of ['protocol', 'executions', 'statements'] as const) {
    const p = new NpcStreamParser(options);
    const first = p.pushChunk(JSON.stringify(fields).slice(0, -1));
    assert.equal(first.filter((e) => e.kind === 'execution_intents').length, 1);
    const duplicate = p.pushChunk(`,${JSON.stringify(key)}:${JSON.stringify(fields[key])}`);
    assert.deepEqual(duplicate, [
      { kind: 'statement_error', segmentIndex: 1, code: 'STREAM_DUPLICATE_TOP_LEVEL_KEY' },
    ]);
    assert.deepEqual(p.pushChunk('}'), []);
  }
});
