import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { officialFixture } from './fixtures/official-life.ts';
import { officialGenesis } from '../src/modules/world/domain/official-genesis.ts';
import { actorContext } from '../src/modules/world/application/actor-context.ts';
import { projectPlayerActors } from '../src/modules/world/domain/player-projection.ts';
import { projectPlayerRecords } from '../src/modules/world/domain/player-records.ts';
import {
  OfficialLifeListSchema,
  OfficialLifeStartRequestSchema,
} from '../src/contracts/official-lives.ts';
import { PlayerRecordsSchema } from '../src/contracts/world-records.ts';
const build = (pack = officialFixture()) =>
  officialGenesis({
    opening: pack.opening,
    presetId: pack.card.id,
    contentVersion: pack.card.version,
    worldId: randomUUID(),
    ownerId: randomUUID(),
    title: pack.card.title,
    newId: randomUUID,
  });
test('authored genesis preserves old NPC-only records and exact current timestamps without accepting invitations', () => {
  const s = build();
  assert.equal(s.version, 0);
  assert.equal(s.messages.length, 9);
  assert.equal(s.messages.filter((m) => m.history).length, 6);
  assert.ok(s.messages.every((m) => m.role === 'assistant'));
  assert.deepEqual(
    s.messages.filter((m) => !m.history).map((m) => m.at),
    ['2026-10-09T08:55:00.000Z', '2026-10-09T09:28:00.000Z', '2026-10-09T09:36:00.000Z'],
  );
  assert.equal(s.appointments[0]!.status, 'proposed');
  assert.equal(s.appointments[0]!.at, '2026-10-09T11:00:00.000Z');
  assert.equal(s.mediaRequests.length, 0);
});
test('authored actor knowledge and owner notes are filtered before the real NPC context', () => {
  const s = build();
  const known = actorContext(s, s.actors[0]!.id),
    other = actorContext(s, s.actors[2]!.id);
  assert.ok(known.facts.some((f) => f.text === 'Hidden car owner'));
  assert.ok(!other.facts.some((f) => f.text === 'Hidden car owner'));
  assert.ok(!known.facts.some((f) => f.text === 'Player-only resource'));
  const publicContacts = projectPlayerActors(s, []);
  assert.equal(publicContacts.length, 6);
  assert.equal(publicContacts[0]!.relationship, 'Known role 0');
  assert.ok(!JSON.stringify(publicContacts).includes('Only my own knowledge'));
});
test('references, duplicate keys, accidental player history and unproven invitation sources are rejected', () => {
  for (const mutate of [
    (p: ReturnType<typeof officialFixture>) => {
      p.opening.facts[0]!.visibility = { kind: 'actors', actorKeys: ['missing'] };
    },
    (p: ReturnType<typeof officialFixture>) => {
      p.opening.messages[0]!.key = p.opening.messages[1]!.key;
    },
    (p: ReturnType<typeof officialFixture>) => {
      p.opening.messages[0]!.minutesBeforeStart = -1;
    },
    (p: ReturnType<typeof officialFixture>) => {
      p.opening.invitations[0]!.sourceMessageKey = 'unknown';
    },
    (p: ReturnType<typeof officialFixture>) => {
      p.opening.actors.pop();
    },
  ]) {
    const p = officialFixture();
    mutate(p);
    assert.throws(() => build(p));
  }
});
test('editorial material is read-only sourced context; backstage facts are not public records', () => {
  const p = officialFixture(),
    s = build(p),
    seedId = randomUUID();
  const records = PlayerRecordsSchema.parse(
    projectPlayerRecords({
      worldId: s.id,
      worldVersion: 0,
      initial: s,
      opening: {
        seedId,
        identity: p.opening.identity,
        setting: p.opening.setting,
        officialSource: { presetId: p.card.id, version: 1 },
      },
      choices: [],
      appointments: s.appointments,
      messages: [],
      actors: s.actors,
      events: [],
    }),
  );
  assert.ok(records.about.some((r) => r.text.includes('Editorial R17')));
  assert.equal(records.current[0]!.state, 'proposed');
  assert.ok(!JSON.stringify(records).includes('Hidden car owner'));
  assert.ok(records.about.every((r) => r.id.startsWith('sys/')));
});
test('public catalog cannot contain internal personas and starts cannot select private profile data', () => {
  const p = officialFixture();
  assert.ok(OfficialLifeListSchema.safeParse({ lives: [{ ...p.card, worldId: null }] }).success);
  assert.ok(
    !OfficialLifeListSchema.safeParse({ lives: [{ ...p.card, worldId: null, opening: p.opening }] })
      .success,
  );
  assert.ok(
    !OfficialLifeStartRequestSchema.safeParse({
      commandId: randomUUID(),
      version: 1,
      profileId: randomUUID(),
    }).success,
  );
});
