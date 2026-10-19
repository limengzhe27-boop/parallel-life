import test from 'node:test';
import assert from 'node:assert/strict';
import { npcAgendaRuntimeConfig } from '../src/server/npc-agenda-runtime-config.ts';
test('agenda time and each persistent budget are independent server configuration', () => {
  const c = npcAgendaRuntimeConfig({
    NPC_AGENDA_REVIEW_REAL_GAP_MS: '15000',
    NPC_AGENDA_REVIEW_WORLD_LIMIT: '3',
  });
  assert.equal(c.policy.realGapMs, 15000);
  assert.equal(c.budgets.world.limit, 3);
  assert.equal(c.budgets.actor.limit, 4);
  assert.equal(npcAgendaRuntimeConfig({}).budgets.world.limit, 16);
  for (const env of [
    { NPC_AGENDA_REVIEW_ACTOR_LIMIT: '0' },
    { NPC_AGENDA_REVIEW_QUIET_BACKOFF: '0.5' },
    { NPC_AGENDA_REVIEW_REAL_GAP_MS: '500000' },
    { NPC_AGENDA_REVIEW_OWNER_WINDOW_SECONDS: 'oops' },
  ])
    assert.throws(() => npcAgendaRuntimeConfig(env), /INVALID_NPC_AGENDA_CONFIGURATION/);
});
