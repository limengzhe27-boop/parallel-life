import test from 'node:test';
import assert from 'node:assert/strict';
import { readOpeningReviewEvidence } from '../src/modules/world/infrastructure/authored-opening-context-evidence.ts';
import type { SqlClient } from '../src/modules/storage/infrastructure/postgres.ts';

const snapshot = { evaluationCause: { kind: 'periodic_review' }, observations: [] };
function reader(prior: Record<string, unknown>[]) {
  const queries: string[] = [];
  return {
    queries,
    sql: {
      async query(query: string, values: unknown[]) {
        queries.push(query);
        if (queries.length === 1) return { rows: prior };
        assert.equal(values[3], 3);
        return { rows: [{ id: 'actual-player-message', actor_id: 'actor', version: 7 }] };
      },
    } as unknown as SqlClient,
  };
}
test('opening reconsideration reads the committed decision mode, not a removed wire-mode field', async () => {
  const r = reader([
    { status: 'committed', decision_mode: 'quiet', snapshot, expected_world_version: 3 },
  ]);
  assert.deepEqual(await readOpeningReviewEvidence(r.sql, 'owner', 'world', 2, 7, ['actor']), [
    { sourceId: 'message:actual-player-message', actorId: 'actor', worldVersion: 7 },
  ]);
  assert.match(r.queries[0]!, /d\.document->>'mode'/);
  assert.doesNotMatch(r.queries[0]!, /SELECT a\.response,/);
  assert.match(r.queries[1]!, /c\.status='succeeded'/);
  assert.match(r.queries[1]!, /m\.actor_id=ANY/);
});
test('a raw quiet-looking response cannot override the actual coordinated decision', async () => {
  const r = reader([
    {
      status: 'committed',
      decision_mode: 'coordinate',
      response: '{"mode":"quiet"}',
      snapshot,
      expected_world_version: 3,
    },
  ]);
  assert.deepEqual(await readOpeningReviewEvidence(r.sql, 'owner', 'world', 2, 7, ['actor']), []);
  assert.equal(r.queries.length, 1);
});
test('no opening participants does not scan attempts or messages', async () => {
  const r = reader([]);
  assert.deepEqual(await readOpeningReviewEvidence(r.sql, 'owner', 'world', 2, 7, []), []);
  assert.equal(r.queries.length, 0);
});
