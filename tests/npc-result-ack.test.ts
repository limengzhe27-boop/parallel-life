import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldTurnPlanner } from '../src/modules/world/infrastructure/turn-planner.ts';
import type { ActorContext } from '../src/modules/world/application/ports.ts';
import { resultAckPrefix } from '../src/modules/world/domain/matter-progression.ts';

const target = '10000000-0000-4000-8000-000000000001';
const proof = {
  id: 'matter_result:stored-event:R17',
  sourceEventId: 'stored-event',
  kind: 'canonical' as const,
  text: 'R17交接记录已保存，老周实际收到交付。',
  visibility: { kind: 'actors' as const, actorIds: [target] },
};
const context: ActorContext = {
  worldId: 'world',
  worldVersion: 1,
  time: '2026-10-12T00:00:00.000Z',
  actor: { id: target, name: '老周', relationship: '合作伙伴', persona: '修理铺合作伙伴' },
  facts: [proof],
  messages: [],
  appointments: [],
};
async function propose(
  actorId: string | undefined,
  options: {
    ack?: unknown;
    text?: string;
    context?: ActorContext;
    reply?: boolean;
  } = {},
) {
  const result = await new WorldTurnPlanner({
    async complete() {
      return JSON.stringify({
        schemaVersion: 1,
        effects:
          options.reply === false
            ? [{ type: 'belief.recorded', id: 'b', actorId, text: '普通看法' }]
            : [
                {
                  type: 'message.received',
                  id: 'r',
                  actorId,
                  text: options.text ?? 'R17交接记录收到了，下一次接单可以先整理这份案例。',
                },
              ],
        acknowledgedResultFactIds: options.ack === undefined ? [proof.id] : options.ack,
      });
    },
  }).propose({ context: options.context ?? context, userText: '之后可以做什么？' });
  return result as {
    effects: { type: string; actorId?: string; text?: string }[];
    acknowledgedResultFactIds?: unknown;
  };
}
const acknowledgements = (result: Awaited<ReturnType<typeof propose>>) =>
  result.effects.filter((e) => e.type === 'belief.recorded' && e.text?.startsWith(resultAckPrefix));

test('current speaker name and bounded model placeholders acknowledge the same stored visible result', async () => {
  for (const id of [target, '老周', 'ACTOR_ID', 'actor_1']) {
    const result = await propose(id);
    assert.equal(acknowledgements(result).length, 1, id);
    assert.equal(acknowledgements(result)[0]?.actorId, target);
    assert.equal(result.acknowledgedResultFactIds, undefined);
  }
});
test('foreign identities do not acquire current actor acknowledgement authority', async () => {
  for (const id of ['another-actor', '刘航', '10000000-0000-4000-8000-000000000002'])
    assert.equal(acknowledgements(await propose(id)).length, 0, id);
});
test('a local-looking ID bound to another known recipient is not an alias', async () => {
  assert.equal(
    acknowledgements(
      await propose('actor_1', {
        context: {
          ...context,
          possibleRecipients: [
            { id: 'actor_1', name: '刘航', relationship: '同事', persona: '邻店店主' },
          ],
        },
      }),
    ).length,
    0,
  );
});
test('an ambiguous current name and missing actor ID do not acknowledge', async () => {
  assert.equal(
    acknowledgements(
      await propose('老周', {
        context: {
          ...context,
          possibleRecipients: [
            { id: 'other', name: '老周', relationship: '同事', persona: '同名其他人物' },
          ],
        },
      }),
    ).length,
    0,
  );
  assert.equal(acknowledgements(await propose(undefined)).length, 0);
});
test('no explicit acknowledgement or no dialogue does not consume result', async () => {
  assert.equal(acknowledgements(await propose('老周', { ack: [] })).length, 0);
  assert.equal(acknowledgements(await propose('老周', { reply: false })).length, 0);
});
test('alias does not authorize hidden, noncanonical, forged source or foreign result IDs', async () => {
  for (const fact of [
    { ...proof, visibility: { kind: 'actors' as const, actorIds: ['other'] } },
    { ...proof, kind: 'belief' as const },
    { ...proof, sourceEventId: 'another-event' },
  ])
    assert.equal(
      acknowledgements(await propose('老周', { context: { ...context, facts: [fact] } })).length,
      0,
    );
  assert.equal(
    acknowledgements(await propose('老周', { ack: ['matter_result:foreign:R18'] })).length,
    0,
  );
});
test('invalid dialogue remains rejected before any result acknowledgement', async () => {
  for (const text of ['', '{"schemaVersion":1,"effects":[]}', `${resultAckPrefix}${proof.id}]`])
    await assert.rejects(propose('老周', { text }), /MODEL_OUTPUT_NOT_DIALOGUE/);
});
