import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresWorldSpace } from '../../src/modules/world/infrastructure/space-repository.ts';
import { officialLifeCatalog } from '../../src/modules/settings/infrastructure/official-presets/index.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import { canAppendTravelAfter } from '../../src/modules/world/domain/travel-version-admission.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

test('route intent appends after proven independent NPC exchange, preserving actual movement and receipt authority (real PG)', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, 55675);
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  t.after(async () => {
    await db.close();
    await admin.end();
  });
  const worlds = new PostgresWorldRepository(db),
    space = new PostgresWorldSpace(db, officialLifeCatalog);
  async function fixture(withAppointment = false) {
    const owner = randomUUID(),
      worldId = randomUUID(),
      actorId = randomUUID(),
      appointmentId = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const source = {
      kind: 'seed_genesis' as const,
      seedId: randomUUID(),
      snapshotVersion: 0 as const,
    };
    const state: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      title: 'Synthetic travel race',
      version: 0,
      time: '2026-10-14T01:00:00.000Z',
      actors: [{ id: actorId, name: 'A', persona: 'Independent' }],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
      space: {
        currentPlaceId: 'home',
        positionSource: source,
        places: ['home', 'office'].map((id) => ({
          id,
          name: id,
          description: '',
          source,
          contactActorIds: [],
          appointmentIds: id === 'office' ? [appointmentId] : [],
        })),
        routes: [
          {
            id: 'home_office',
            fromPlaceId: 'home',
            toPlaceId: 'office',
            durationMinutes: 10,
            modeLabel: 'Walk',
            source,
          },
          {
            id: 'office_home',
            fromPlaceId: 'office',
            toPlaceId: 'home',
            durationMinutes: 10,
            modeLabel: 'Walk',
            source,
          },
        ],
      },
    };
    await worlds.initialize({ userId: owner }, state);
    let version = 0;
    if (withAppointment) {
      const cmd = {
        id: randomUUID(),
        worldId,
        actorId,
        expectedVersion: 0,
        text: 'Synthetic appointment source',
      };
      await worlds.commit({ userId: owner }, cmd, {
        schemaVersion: 1,
        id: randomUUID(),
        worldId,
        commandId: cmd.id,
        version: 1,
        occurredAt: new Date().toISOString(),
        type: 'turn.resolved',
        data: {
          actorId,
          userText: cmd.text,
          effects: [
            { type: 'message.received', id: randomUUID(), actorId, text: 'Synthetic invitation' },
            {
              type: 'appointment.proposed',
              id: appointmentId,
              title: 'Office meeting',
              at: '2026-10-14T02:00:00.000Z',
              participantIds: [actorId],
            },
          ],
        },
      });
      await worlds.respondToInvitation(
        { userId: owner },
        {
          commandId: randomUUID(),
          worldId,
          id: appointmentId,
          operation: 'accept',
          expectedVersion: 1,
        },
      );
      version = 2;
    }
    const world = await worlds.get({ userId: owner }, worldId);
    await db.transaction(owner, async (sql) => {
      await initializeActorAgentStateInTransaction(
        sql,
        owner,
        emptyActorAgentState({ worldId, actorId }, agentDefinitionRef(world, actorId), version),
      );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: version,
      });
    });
    return { owner, worldId, actorId, appointmentId, version };
  }
  async function ordinary(f: Awaited<ReturnType<typeof fixture>>) {
    let calls = 0;
    const service = npcAgentServices(db, () => ({
      async complete() {
        calls++;
        return JSON.stringify({
          statements: [{ text: 'I am thinking about my own afternoon.', dependsOnActionIds: [] }],
          goals: [],
          plans: [],
          actions: [],
          responsibilities: [],
          decisions: [],
        });
      },
    }));
    const input = {
      id: randomUUID(),
      worldId: f.worldId,
      expectedVersion: f.version,
      actorId: f.actorId,
      text: 'How is your afternoon?',
    };
    const result = await service.sendMessageIfEnabled(f.owner, input);
    assert.equal(result?.status, 'committed');
    return { calls: () => calls, service, input };
  }
  await t.test(
    'NPC text arriving after map read does not block travel; replay stays one movement with unchanged request',
    async () => {
      const f = await fixture();
      const request = {
        commandId: randomUUID(),
        expectedVersion: f.version,
        routeId: 'home_office',
      };
      const npc = await ordinary(f);
      const receipt = await space.travel(f.owner, f.worldId, request);
      assert.equal(receipt.version, 2);
      assert.equal(receipt.fromPlaceId, 'home');
      assert.equal(receipt.toPlaceId, 'office');
      assert.deepEqual(await space.travel(f.owner, f.worldId, request), receipt);
      assert.deepEqual(await space.recover(f.owner, f.worldId, request), receipt);
      assert.equal(npc.calls(), 1);
      const row = (
        await admin.query(
          'SELECT expected_version,request_payload FROM parallel_life.commands WHERE world_id=$1 AND id=$2',
          [f.worldId, request.commandId],
        )
      ).rows[0];
      assert.equal(row.expected_version, 1);
      assert.deepEqual(row.request_payload, request);
      assert.equal(
        (
          await admin.query(
            "SELECT 1 FROM parallel_life.world_events WHERE world_id=$1 AND payload->>'type'='travel.completed'",
            [f.worldId],
          )
        ).rowCount,
        1,
      );
    },
  );
  await t.test(
    'another player movement invalidates stale intent even when the player has returned to the same place',
    async () => {
      const f = await fixture();
      const stale = { commandId: randomUUID(), expectedVersion: 0, routeId: 'home_office' };
      await space.travel(f.owner, f.worldId, { ...stale, commandId: randomUUID() });
      await space.travel(f.owner, f.worldId, {
        commandId: randomUUID(),
        expectedVersion: 1,
        routeId: 'office_home',
      });
      await assert.rejects(space.travel(f.owner, f.worldId, stale), { code: 'VERSION_CONFLICT' });
      assert.equal(
        (await worlds.get({ userId: f.owner }, f.worldId)).space?.currentPlaceId,
        'home',
      );
    },
  );
  await t.test(
    'actual appointment cancellation remains a conflict and cannot be bypassed as ordinary dialogue',
    async () => {
      const f = await fixture(true);
      const stale = { commandId: randomUUID(), expectedVersion: f.version, routeId: 'home_office' };
      await ordinary(f);
      await worlds.respondToInvitation(
        { userId: f.owner },
        {
          commandId: randomUUID(),
          worldId: f.worldId,
          id: f.appointmentId,
          operation: 'cancel',
          expectedVersion: f.version + 1,
        },
      );
      await assert.rejects(space.travel(f.owner, f.worldId, stale), { code: 'VERSION_CONFLICT' });
      assert.equal(
        (await worlds.get({ userId: f.owner }, f.worldId)).appointments[0]!.status,
        'cancelled',
      );
    },
  );
  await t.test(
    'pure admission refuses gaps, unknown effects, spatial metadata and future versions',
    async () => {
      const f = await fixture();
      await ordinary(f);
      const row = (
        await admin.query(
          'SELECT version,payload FROM parallel_life.world_events WHERE world_id=$1 ORDER BY version',
          [f.worldId],
        )
      ).rows[0];
      const base = { worldId: f.worldId, expectedVersion: 0, actualVersion: 1, events: [row] };
      assert.equal(canAppendTravelAfter(base), true);
      for (const p of [
        { ...base, events: [] },
        { ...base, expectedVersion: 2 },
        { ...base, actualVersion: 300 },
        { ...base, events: [{ ...row, version: 2 }] },
        {
          ...base,
          events: [
            {
              ...row,
              payload: {
                ...row.payload,
                data: { ...row.payload.data, effects: [{ type: 'appointment.cancelled' }] },
              },
            },
          ],
        },
        {
          ...base,
          events: [
            {
              ...row,
              payload: {
                ...row.payload,
                data: {
                  ...row.payload.data,
                  agentRuntime: { ...row.payload.data.agentRuntime, initialPositions: [{}] },
                },
              },
            },
          ],
        },
      ])
        assert.equal(canAppendTravelAfter(p), false);
    },
  );
});
