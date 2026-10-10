import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { OfficialLifeCardSchema } from '../src/contracts/official-lives.ts';
import {
  OFFICIAL_LIFE_PACKS,
  officialLifeCatalog,
} from '../src/modules/settings/infrastructure/official-presets/index.ts';
import { actorContext } from '../src/modules/world/application/actor-context.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
import type { OfficialLifePack } from '../src/modules/settings/application/official-life-pack.ts';

// Map editorial keys in an isolated fixture to exercise the existing knowledge boundary.
// Actual genesis/transaction/start behavior is covered by the integrator's tests.
function actorFixture(pack: OfficialLifePack) {
  const id = randomUUID(),
    ownerId = randomUUID();
  const ids = new Map(pack.opening.actors.map((a) => [a.key, randomUUID()]));
  const state: WorldState = {
    schemaVersion: 1,
    id,
    ownerId,
    version: 0,
    title: pack.card.title,
    time: pack.opening.startAt,
    actors: pack.opening.actors.map((a) => ({
      id: ids.get(a.key)!,
      name: a.name,
      relationship: a.relationship,
      persona: a.persona,
    })),
    facts: pack.opening.facts.map((f) => ({
      id: randomUUID(),
      text: f.text,
      kind: 'canonical',
      sourceEventId: `genesis:${id}`,
      visibility:
        f.visibility.kind === 'actors'
          ? { kind: 'actors', actorIds: f.visibility.actorKeys.map((k) => ids.get(k)!) }
          : f.visibility,
    })),
    actorTies: [],
    appointments: [],
    mediaRequests: [],
    messages: pack.opening.messages.map((m) => ({
      id: randomUUID(),
      actorId: ids.get(m.actorKey)!,
      role: 'assistant',
      text: m.text,
      at: new Date(Date.parse(pack.opening.startAt) - m.minutesBeforeStart * 60000).toISOString(),
      sourceEventId: `genesis:${id}`,
    })),
  };
  return {
    state,
    ids,
    facts: (key: string) =>
      actorContext(state, ids.get(key)!, '今晚有什么需要我知道的？')
        .facts.map((f) => f.text)
        .join('\n'),
  };
}

for (const pack of OFFICIAL_LIFE_PACKS) {
  test(`${pack.card.title}: playable-entry data stays scoped, dated and referenced`, () => {
    OfficialLifeCardSchema.parse({ ...pack.card, worldId: null });
    const o = pack.opening,
      cast = new Set(o.actors.map((a) => a.key));
    assert.equal(cast.size, 6);
    const messageKeys = new Set(o.messages.map((m) => m.key));
    assert.equal(messageKeys.size, o.messages.length);
    for (const actor of o.actors) {
      assert(
        o.messages.some((m) => m.actorKey === actor.key && m.history),
        `${actor.name} needs older letters`,
      );
      assert(actor.persona.length <= 1200);
      assert(!actor.persona.includes('http'));
    }
    const current = o.messages.filter((m) => !m.history);
    assert.equal(current.length, 3);
    assert.equal(new Set(current.map((m) => m.minutesBeforeStart)).size, 3);
    assert(current.every((m) => m.minutesBeforeStart > 0 && m.minutesBeforeStart < 120));
    assert(o.messages.every((m) => cast.has(m.actorKey) && m.text.length <= 160));
    assert(o.messages.filter((m) => m.history).every((m) => m.minutesBeforeStart >= 60));
    for (const f of o.facts)
      if (f.visibility.kind === 'actors') assert(f.visibility.actorKeys.every((k) => cast.has(k)));
    for (const i of o.invitations) {
      const source = o.messages.find((m) => m.key === i.sourceMessageKey);
      assert(source && i.actorKeys.includes(source.actorKey));
      assert(i.minutesAfterStart > 0);
      assert(i.actorKeys.every((k) => cast.has(k)));
    }
    assert(!JSON.stringify(o.notes).includes('https://'), 'No fictional file URLs');
    assert(!JSON.stringify(o.notes).includes('下一章'), 'Do not expose a fixed sequence');
    assert(!('assets' in pack), 'No invented photos in the content pack');
  });
}

test('黄毛: repair/customer knowledge is unavailable to girlfriend, father and friend', () => {
  const f = actorFixture(OFFICIAL_LIFE_PACKS[0]);
  assert.match(f.facts('laozhou'), /R17/);
  for (const key of ['linyue', 'linfu', 'ajie', 'chenfu'])
    assert.doesNotMatch(f.facts(key), /R17|350元/);
  assert.doesNotMatch(f.facts('liuhang'), /三天前主角修好/);
  assert.doesNotMatch(f.facts('ajie'), /17:32/);
});

test('独生子: the two evidence holders cannot see each other’s non-shared documents', () => {
  const f = actorFixture(OFFICIAL_LIFE_PACKS[1]);
  assert.match(f.facts('chenfang'), /40人确认/);
  assert.doesNotMatch(f.facts('chenfang'), /最早D\+2/);
  assert.match(f.facts('shaoqing'), /最早D\+2/);
  assert.doesNotMatch(f.facts('shaoqing'), /160人|5万元|摄影小册/);
  assert.doesNotMatch(f.facts('guyao'), /设备报价|供应商交付/);
});

test('真千金: proposed introduction and mistaken attribution are not family-wide knowledge', () => {
  const f = actorFixture(OFFICIAL_LIFE_PACKS[2]);
  assert.match(f.facts('zhoulan'), /未授权草稿/);
  for (const key of ['chenyu', 'chengye', 'xuwen', 'mingzhu', 'xuhong'])
    assert.doesNotMatch(f.facts(key), /未授权草稿/);
  assert.match(f.facts('xuwen'), /没有向主角核实/);
  assert.doesNotMatch(f.facts('zhoulan'), /没有向主角核实/);
  assert.doesNotMatch(f.facts('mingzhu'), /20:00下班|小纪念册/);
});

test('顶流: song arrangement is for performers, private meal is for neighbor', () => {
  const f = actorFixture(OFFICIAL_LIFE_PACKS[3]);
  assert.match(f.facts('lusheng'), /没说完的话/);
  assert.match(f.facts('xuan'), /没说完的话/);
  for (const key of ['songqing', 'chengxiao', 'jiyuan', 'tangli'])
    assert.doesNotMatch(f.facts(key), /没说完的话/);
  assert.match(f.facts('chengxiao'), /朋友想擅自加人/);
  assert.doesNotMatch(f.facts('lusheng'), /朋友想擅自加人/);
});

test('scheduled story instants match the four opening clocks and do not collapse into arrival time', () => {
  const minutes = (pack: OfficialLifePack, key: string) => {
    const invitation = pack.opening.invitations.find((i) => i.key === key)!;
    const d = new Date(
      Date.parse(pack.opening.startAt) + invitation.minutesAfterStart * 60000 + 8 * 3600000,
    );
    return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  };
  assert.equal(minutes(OFFICIAL_LIFE_PACKS[0], 'family_dinner'), '19:00');
  assert.equal(minutes(OFFICIAL_LIFE_PACKS[0], 'workshop_visit'), '18:30');
  assert.equal(minutes(OFFICIAL_LIFE_PACKS[1], 'dinner'), '19:30');
  assert.equal(minutes(OFFICIAL_LIFE_PACKS[2], 'birthday'), '18:30');
  assert.equal(minutes(OFFICIAL_LIFE_PACKS[3], 'show'), '20:00');
  assert.equal(minutes(OFFICIAL_LIFE_PACKS[3], 'meal'), '18:00');
});

test('catalog returns detached content and never a shared player save', () => {
  const first = officialLifeCatalog.list();
  assert.equal(first.length, 4);
  first[0]!.opening.actors[0]!.persona = 'changed in caller';
  assert.notEqual(
    officialLifeCatalog.get('county-yellow-hair')!.opening.actors[0]!.persona,
    'changed in caller',
  );
  assert(officialLifeCatalog.list().every((p) => !('worldId' in p.card)));
});
