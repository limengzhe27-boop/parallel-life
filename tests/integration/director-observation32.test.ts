import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { switchAgentEngineEpochInTransaction } from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import {
  npcAgentAdvanceServices,
  agentWakeCommandId,
} from '../../src/server/npc-agent-advance-services.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import type { TextModel } from '../../src/modules/ai/application/ports.ts';

import { PostgresWorldSpace } from '../../src/modules/world/infrastructure/space-repository.ts';
import { PostgresWorldAwarenessRepository } from '../../src/modules/world/infrastructure/world-awareness-repository.ts';
import { PostgresDirectorReviewRepository } from '../../src/modules/world/infrastructure/director-review-repository.ts';
import { runDirectorAgent } from '../../src/modules/world/application/run-director-agent.ts';
import {
  PostgresDirectorRuntimeRepository,
  directorCoordinationFrameHash,
  directorSnapshotInputHash,
} from '../../src/modules/world/infrastructure/director-runtime-repository.ts';
import {
  WorldDirectorAgentModel,
  parseDirectorDecision,
} from '../../src/modules/world/infrastructure/director-agent-model.ts';
for (const failure of ['unknown', 'invalid', 'legacy_invalid'] as const)
  test(
    'pending observation preserves ' + failure + ' paid identity across unrelated changes',
    async () => {
      const cfg = await localConfig();
      assert.equal(cfg.port, 55432, 'local synthetic cluster only');
      const admin = await adminClient('parallel_life_test');
      await migrate(admin);
      const db = new PostgresDatabase(
        `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
      );
      try {
        const owner = randomUUID(),
          worldId = randomUUID();
        await new IdentityRepository(db).ensureGuest(owner);
        const source = {
          kind: 'seed_genesis' as const,
          seedId: randomUUID(),
          snapshotVersion: 0 as const,
        };
        const world: WorldState = {
          schemaVersion: 1,
          id: worldId,
          ownerId: owner,
          version: 0,
          title: 'Director wake test',
          time: '2026-10-21T06:00:00.000Z',
          // Isolate the global dispatcher: no actor-local work or paid NPC call can explain the result.
          actors: [],
          facts: [],
          messages: [],
          appointments: [],
          mediaRequests: [],
          space: {
            currentPlaceId: 'home',
            positionSource: source,
            places: ['home', 'shop'].map((id) => ({
              id,
              name: id,
              description: '',
              source,
              contactActorIds: [],
              appointmentIds: [],
            })),
            routes: [
              {
                id: 'walk',
                fromPlaceId: 'home',
                toPlaceId: 'shop',
                durationMinutes: 1,
                modeLabel: '步行',
                source,
              },
              {
                id: 'back',
                fromPlaceId: 'shop',
                toPlaceId: 'home',
                durationMinutes: 1,
                modeLabel: '步行',
                source,
              },
            ],
          },
        };
        const worlds = new PostgresWorldRepository(db);
        await worlds.initialize({ userId: owner }, world);
        await db.transaction(owner, async (sql) => {
          await switchAgentEngineEpochInTransaction(sql, owner, {
            worldId,
            expectedEpoch: 1,
            nextEpoch: 2,
            expectedWorldVersion: 0,
          });
        });

        await db.transaction(owner, (sql) =>
          sql.query(
            'INSERT INTO parallel_life.director_observed_states(world_id,owner_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
            [worldId, owner],
          ),
        );
        await new PostgresClockStore(db).setClock(owner, worldId, { paused: false, speed: 0 });
        let calls = 0;
        let unknown = false;
        const model: TextModel = {
          async complete(messages) {
            const p = JSON.parse(messages[1]!.content);
            assert.ok(p.promptVersion.startsWith('director-'));
            assert.equal(p.candidates.length, 0);
            calls++;
            if (unknown) {
              if (failure === 'unknown') throw Error('SYNTHETIC_LOST_RESPONSE');
              return '{invalid';
            }
            return JSON.stringify({
              protocol: 'director-wire-v14',
              openingContext: null,
              authoredChoices: {},
              candidates: [],
              opportunities: [],
              audit: { reason: '没有需要额外安排的机会。', sourceRefs: [] },
            });
          },
        };
        const service = npcAgentAdvanceServices(
          db,
          () => model,
          new PostgresDirectorSnapshotRepository(db),
        );
        await service.advanceIfEnabled(owner, worldId);
        assert.equal(calls, 1);
        await service.advanceIfEnabled(owner, worldId);
        assert.equal(calls, 1, 'no pending change cannot buy another review');
        const awareness = new PostgresWorldAwarenessRepository(db);
        const review = await new PostgresDirectorReviewRepository(db).read(owner, worldId);
        assert.ok(Date.parse(review!.nextReviewAt) > Date.now());
        await new PostgresWorldSpace(db, { list: () => [], get: () => undefined }).travel(
          owner,
          worldId,
          {
            commandId: randomUUID(),
            expectedVersion: 0,
            routeId: 'walk',
          },
        );
        const pending = await awareness.readDirectorObservedState(owner, worldId);
        assert.equal(
          pending.needsEvaluation,
          true,
          'real travel produces authoritative pending reason',
        );
        await service.advanceIfEnabled(owner, worldId);
        assert.equal(
          calls,
          2,
          'pending change is considered despite zero candidates and not-due cadence',
        );
        const after = await awareness.readDirectorObservedState(owner, worldId);
        assert.equal(after.needsEvaluation, false);
        assert.equal(after.evaluatedThroughVersion, after.observedThroughVersion);
        await service.advanceIfEnabled(owner, worldId);
        assert.equal(calls, 2, 'consumed reason cannot purchase again');
        const current = await worlds.get({ userId: owner }, worldId);
        await new PostgresWorldSpace(db, { list: () => [], get: () => undefined }).travel(
          owner,
          worldId,
          {
            commandId: randomUUID(),
            expectedVersion: current.version,
            routeId: 'back',
          },
        );
        unknown = true;
        if (failure === 'legacy_invalid') {
          const current = await worlds.get({ userId: owner }, worldId);
          const snapshot = await new PostgresDirectorSnapshotRepository(db).read(owner, {
            worldId,
            engineEpoch: 2,
            worldVersion: current.version,
            candidates: [],
            blockers: [],
          });
          const legacyCommand = agentWakeCommandId(
            worldId,
            directorCoordinationFrameHash(snapshot),
          );
          await assert.rejects(
            runDirectorAgent(
              {
                attempts: new PostgresDirectorRuntimeRepository(db),
                model: new WorldDirectorAgentModel(model),
                parse: parseDirectorDecision,
              },
              owner,
              {
                id: randomUUID(),
                worldId,
                commandId: legacyCommand,
                engineEpoch: 2,
                expectedWorldVersion: current.version,
                inputHash: directorSnapshotInputHash(snapshot),
                token: randomUUID(),
                leaseUntil: new Date(Date.now() + 60000).toISOString(),
              },
              snapshot,
            ),
          );
        } else await assert.rejects(service.advanceIfEnabled(owner, worldId));
        assert.equal(calls, 3);
        await service.advanceIfEnabled(owner, worldId).catch(() => {});
        assert.equal(calls, 3, 'unknown pending review is never repurchased');
        assert.equal(
          (await awareness.readDirectorObservedState(owner, worldId)).needsEvaluation,
          true,
        );
        const ledger = (
          await admin.query(
            'SELECT * FROM parallel_life.director_runtime_attempts WHERE world_id=$1 ORDER BY created_at DESC LIMIT 1',
            [worldId],
          )
        ).rows[0];
        assert.equal(
          ledger.status,
          failure === 'unknown' ? 'unknown_after_send' : 'invalid_output',
        );
        if (failure === 'legacy_invalid') {
          const repo = new PostgresDirectorRuntimeRepository(db);
          const oldSnapshot = ledger.snapshot;
          const found = await repo.lookup(owner, worldId, randomUUID(), oldSnapshot);
          assert.equal(
            found!.id,
            ledger.id,
            'old frame paid evidence matches authenticated reason set',
          );
          assert.equal(
            await repo.lookup(owner, worldId, randomUUID(), { ...oldSnapshot, engineEpoch: 3 }),
            null,
            'different epoch cannot borrow old paid evidence',
          );
        }
        const latest = await worlds.get({ userId: owner }, worldId);
        const clockStore = new PostgresClockStore(db);
        const clock = await clockStore.read(owner, worldId);
        await clockStore.write(owner, worldId, {
          ...clock,
          storyNow: new Date(Date.parse(latest.time) + 60000).toISOString(),
        });
        await service.advanceIfEnabled(owner, worldId).catch(() => {});
        assert.equal(calls, 3, 'time alone cannot repurchase');
        await worlds.saveNote(
          { userId: owner },
          {
            worldId,
            commandId: randomUUID(),
            expectedVersion: latest.version,
            title: '独立笔记',
            text: '不形成新导演原因',
          },
        );
        await service.advanceIfEnabled(owner, worldId).catch(() => {});
        assert.equal(calls, 3, 'unrelated committed version cannot repurchase same reason');
        if (failure !== 'unknown') {
          unknown = false;
          const head = await worlds.get({ userId: owner }, worldId);
          await new PostgresWorldSpace(db, { list: () => [], get: () => undefined }).travel(
            owner,
            worldId,
            { commandId: randomUUID(), expectedVersion: head.version, routeId: 'walk' },
          );
          await service.advanceIfEnabled(owner, worldId);
          assert.equal(calls, 4, 'a genuinely new travel reason gets an independent assessment');
          assert.equal(
            (await awareness.readDirectorObservedState(owner, worldId)).needsEvaluation,
            false,
          );
        }
        assert.deepEqual(
          (
            await admin.query('SELECT * FROM parallel_life.director_runtime_attempts WHERE id=$1', [
              ledger.id,
            ])
          ).rows[0],
          ledger,
          'old paid attempt and snapshot remain immutable',
        );
      } finally {
        await db.close();
        await admin.end();
      }
    },
  );
