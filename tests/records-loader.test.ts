import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  readCoherentRecords,
  RecordsReadError,
  recordsReadError,
} from '../src/features/phone/records-loader.ts';
import type { PlayerRecords } from '../src/contracts/world-records.ts';
import type { WorldPhone } from '../src/contracts/world-build.ts';
const worldId = randomUUID();
const records = (version: number, id = worldId): PlayerRecords => ({
  schemaVersion: 1,
  worldId: id,
  worldVersion: version,
  coverage: 'recent',
  current: [],
  about: [],
  history: [],
});
const phone = (version: number, id = worldId): WorldPhone => ({
  id,
  seedId: randomUUID(),
  version,
  title: '明确测试夹具',
  identity: '测试身份',
  setting: '测试起点',
  time: '2026-10-10T00:00:00.000Z',
  actors: [],
  messages: [],
  notes: [],
});
test('matching versions read records once without reading or writing the phone again', async () => {
  let phoneReads = 0;
  const result = await readCoherentRecords(
    {
      readWorldRecords: async () => records(3),
      world: async () => {
        phoneReads++;
        return phone(3);
      },
    },
    worldId,
    3,
    () => true,
  );
  assert.equal(result?.records.worldVersion, 3);
  assert.equal(result?.phone, undefined);
  assert.equal(phoneReads, 0);
});
test('newer records publish only with a matching real phone snapshot', async () => {
  const result = await readCoherentRecords(
    { readWorldRecords: async () => records(4), world: async () => phone(4) },
    worldId,
    3,
    () => true,
  );
  assert.equal(result?.phone?.version, result?.records.worldVersion);
});
test('an intervening commit reconciles the next record read with the updated phone', async () => {
  let reads = 0;
  const result = await readCoherentRecords(
    { readWorldRecords: async () => records(++reads === 1 ? 4 : 5), world: async () => phone(5) },
    worldId,
    3,
    () => true,
  );
  assert.equal(result?.records.worldVersion, 5);
  assert.equal(result?.phone?.version, 5);
  assert.equal(reads, 2);
});
test('continuous changes stop after a bounded read and never return a mixed pair', async () => {
  let reads = 0,
    phones = 0;
  await assert.rejects(
    readCoherentRecords(
      {
        readWorldRecords: async () => records(++reads * 2),
        world: async () => phone(++phones * 2 + 1),
      },
      worldId,
      1,
      () => true,
    ),
    RecordsReadError,
  );
  assert.equal(reads, 2);
  assert.equal(phones, 2);
});
test('wrong world or a phone snapshot older than the displayed version fails closed', async () => {
  await assert.rejects(
    readCoherentRecords(
      { readWorldRecords: async () => records(3, randomUUID()), world: async () => phone(3) },
      worldId,
      3,
      () => true,
    ),
    RecordsReadError,
  );
  await assert.rejects(
    readCoherentRecords(
      { readWorldRecords: async () => records(2), world: async () => phone(2) },
      worldId,
      3,
      () => true,
    ),
    RecordsReadError,
  );
});
test('a late response after switching world is discarded before any follow-up read', async () => {
  let resolve!: (value: PlayerRecords) => void,
    current = true,
    phoneReads = 0;
  const pending = readCoherentRecords(
    {
      readWorldRecords: () =>
        new Promise((r) => {
          resolve = r;
        }),
      world: async () => {
        phoneReads++;
        return phone(4);
      },
    },
    worldId,
    3,
    () => current,
  );
  current = false;
  resolve(records(4));
  assert.equal(await pending, undefined);
  assert.equal(phoneReads, 0);
});
test('an older retry cannot replace a later successful request', async () => {
  let resolve!: (value: PlayerRecords) => void,
    sequence = 1;
  const previous = readCoherentRecords(
    {
      readWorldRecords: () =>
        new Promise((r) => {
          resolve = r;
        }),
      world: async () => phone(3),
    },
    worldId,
    3,
    () => sequence === 1,
  );
  sequence = 2;
  const latest = await readCoherentRecords(
    { readWorldRecords: async () => records(3), world: async () => phone(3) },
    worldId,
    3,
    () => sequence === 2,
  );
  resolve(records(2));
  assert.equal(await previous, undefined);
  assert.equal(latest?.records.worldVersion, 3);
});
test('records errors expose safe isolated text, without upstream payloads', () => {
  assert.doesNotMatch(recordsReadError(new Error('SECRET_INTERVIEW')), /SECRET/);
  assert.match(recordsReadError(new Error()), /私人便签仍可使用/);
  assert.match(recordsReadError(new RecordsReadError()), /正在更新/);
});
