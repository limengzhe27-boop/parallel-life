import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { countyYellowHair } from '../src/modules/settings/infrastructure/official-presets/county-yellow-hair.ts';
import { officialGenesis } from '../src/modules/world/domain/official-genesis.ts';
import { officialGenesisPositions } from '../src/modules/world/domain/genesis-positions.ts';

const build = () =>
  officialGenesis({
    opening: countyYellowHair.opening,
    presetId: countyYellowHair.card.id,
    contentVersion: countyYellowHair.card.version,
    worldId: randomUUID(),
    ownerId: randomUUID(),
    title: countyYellowHair.card.title,
    newId: randomUUID,
  });

test('the authored shop owner starts at the shop and everyone else stays unknown', () => {
  const world = build(),
    rows = officialGenesisPositions(world, countyYellowHair.opening),
    player = rows.find((row) => row.subjectKey === 'player')!,
    laozhou = world.actors.find((actor) => actor.name === '老周')!,
    liuhang = world.actors.find((actor) => actor.name === '刘航')!;
  assert.deepEqual(player, {
    subjectKey: 'player',
    subject: { kind: 'player' },
    status: 'at',
    placeId: 'repair_shop',
  });
  assert.deepEqual(
    rows.find((row) => row.subjectKey === `actor:${laozhou.id}`),
    {
      subjectKey: `actor:${laozhou.id}`,
      subject: { kind: 'actor', actorId: laozhou.id },
      status: 'at',
      placeId: 'repair_shop',
    },
  );
  assert.deepEqual(
    rows.find((row) => row.subjectKey === `actor:${liuhang.id}`),
    {
      subjectKey: `actor:${liuhang.id}`,
      subject: { kind: 'actor', actorId: liuhang.id },
      status: 'unknown',
      placeId: null,
    },
  );
  assert.equal(rows.filter((row) => row.status === 'at').length, 2);
});

test('an actor cannot be pinned to a missing place or a place that does not list them', () => {
  const missing = structuredClone(countyYellowHair.opening);
  missing.actors.find((actor) => actor.key === 'laozhou')!.initialPlaceKey = 'missing';
  assert.throws(
    () => officialGenesis({ ...baseInput(), opening: missing }),
    /INVALID_OFFICIAL_OPENING/,
  );

  const world = build(),
    notContact = structuredClone(countyYellowHair.opening);
  notContact.actors.find((actor) => actor.key === 'laozhou')!.initialPlaceKey = 'lin_home';
  assert.throws(() => officialGenesisPositions(world, missing), /INVALID_OFFICIAL_POSITION_PLACE/);
  assert.throws(
    () => officialGenesis({ ...baseInput(), opening: notContact }),
    /INVALID_OFFICIAL_OPENING/,
  );
});

function baseInput() {
  return {
    presetId: countyYellowHair.card.id,
    contentVersion: countyYellowHair.card.version,
    worldId: randomUUID(),
    ownerId: randomUUID(),
    title: countyYellowHair.card.title,
    newId: randomUUID,
  };
}
