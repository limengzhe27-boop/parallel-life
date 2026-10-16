import test from 'node:test';
import assert from 'node:assert/strict';
import { progressionFixture, resolveProgressionFixture } from './fixtures/matter-progression.ts';
import { buildAgenda } from '../src/modules/world/domain/agenda.ts';
import { followupAgenda } from '../src/modules/world/domain/return-followups.ts';

// Result-consumption contract tests: the supplied canonical witnessed result is a
// synthetic fixture, not an assertion that a model or a player performed anything.
function fixture() {
  const f = progressionFixture('county-yellow-hair');
  const result = resolveProgressionFixture(f, f.world, f.trigger.id, f.texts[0], f.texts[1]);
  const world = structuredClone(result.world);
  const m = world.matters!.find((m) => m.id === f.trigger.id)!;
  assert.equal(m.evidence?.kind, 'scene_action');
  if (m.evidence?.kind !== 'scene_action') throw Error('fixture evidence');
  const { outcome: _, ...evidence } = m.evidence;
  m.evidence = { ...evidence, kind: 'scene_steps', ruleVersion: 'r17-delivery-v1' };
  return { f, world, m };
}
test('saved witnessed cumulative completion remains an agenda result, including an unstarted next opportunity', () => {
  const { f, world, m } = fixture();
  const threads = buildAgenda(world, 30).filter(
    (t) => t.kind === 'matter_result' && t.basisId === m.id,
  );
  assert.equal(threads.length, 1);
  assert.equal(threads[0]!.actorId, f.actorId);
  assert.ok(threads[0]!.detail?.includes('整理 R17 交接记录'));
  const other = world.actors.find((a) => a.id !== f.actorId)!.id;
  assert.ok(!threads.some((t) => t.actorId === other));
});
test('cumulative result follows the same date, cooldown, version and witness rules as a single action result', () => {
  const { f, world, m } = fixture();
  const agenda = buildAgenda(world, 30).filter(
    (t) => t.kind === 'matter_result' && t.basisId === m.id,
  );
  const before = new Date(Date.parse(m.evidence!.at) - 48 * 60 * 60_000).toISOString();
  const after = new Date(Date.parse(m.evidence!.at) + 24 * 60 * 60_000).toISOString();
  const delivered = [{ actorId: f.actorId, at: before, version: 0 }];
  assert.equal(followupAgenda(world, agenda, after, delivered).length, 1);
  assert.deepEqual(
    followupAgenda(world, agenda, after, [{ ...delivered[0]!, version: m.evidence!.eventVersion }]),
    [],
  );
  assert.deepEqual(followupAgenda(world, agenda, before, []), []);
  world.facts = world.facts.filter((f) => !f.id.startsWith('matter_result:'));
  assert.deepEqual(followupAgenda(world, agenda, after, delivered), []);
});
