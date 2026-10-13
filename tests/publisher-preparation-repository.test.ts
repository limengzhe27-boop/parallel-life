import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PublisherPreparationRepository } from '../src/modules/settings/infrastructure/publisher-preparation-repository.ts';
import type { PostgresDatabase } from '../src/modules/storage/infrastructure/postgres.ts';
import type { PublisherPreparationInput } from '../src/contracts/publisher-preparation.ts';
const principal = '00000000-0000-4000-8000-000000000001';
const workId = '00000000-0000-4000-8000-000000000002';
const input: PublisherPreparationInput = {
  commandId: '00000000-0000-4000-8000-000000000003',
  expectedDraftVersion: 0,
  currentContent: {},
  sources: [{ filename: '人物.md', content: '姓名：阿禾' }],
};
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
const hash = (value: PublisherPreparationInput) =>
  createHash('sha256')
    .update(JSON.stringify(canonical({ workId, ...value })))
    .digest('hex');
function harness(old?: Record<string, unknown>) {
  let row = old;
  let inserts = 0;
  const db = {
    async transaction(_principal: string, run: (sql: unknown) => Promise<unknown>) {
      assert.equal(_principal, principal);
      return run({
        async query(text: string, values: unknown[] = []) {
          if (text.startsWith('SELECT * FROM parallel_life.publisher_preparations'))
            return { rows: row ? [row] : [] };
          if (text.startsWith('SELECT draft_version')) return { rows: [{ draft_version: 0 }] };
          if (text.startsWith('SELECT count(*)')) return { rows: [{ active: 0, recent: 0 }] };
          if (text.startsWith('INSERT INTO parallel_life.publisher_preparations')) {
            inserts++;
            row = {
              command_id: values[1],
              work_id: values[2],
              draft_version: values[3],
              request_hash: values[4],
              material: JSON.parse(values[5] as string),
              status: 'running',
              result: null,
              error_code: null,
              created_at: '2030-01-01T00:00:00Z',
              updated_at: '2030-01-01T00:00:00Z',
            };
            return { rows: [row] };
          }
          return { rows: [] };
        },
      });
    },
  };
  return {
    repo: new PublisherPreparationRepository(db as unknown as PostgresDatabase),
    get row() {
      return row;
    },
    get inserts() {
      return inserts;
    },
  };
}
test('new admission persists resolved scope while request hash retains exact optional scope semantics', async () => {
  const h = harness();
  const result = await h.repo.begin(principal, workId, input);
  assert.equal(result.record.material.scope, 'characters');
  assert.equal(h.row!.request_hash, hash(input));
  assert.equal(result.claimed, true);
  const replay = await h.repo.begin(principal, workId, input);
  assert.equal(replay.claimed, false);
  assert.equal(h.inserts, 1);
  await assert.rejects(h.repo.begin(principal, workId, { ...input, scope: 'characters' }), {
    code: 'IDEMPOTENCY_CONFLICT',
  });
});
test('legacy successful receipt replays without adding scope or changing its result', async () => {
  const result = { updatedContent: {}, summary: '旧提案', notes: [], issues: [] };
  const h = harness({
    command_id: input.commandId,
    work_id: workId,
    draft_version: 0,
    request_hash: hash(input),
    material: { currentContent: {}, sources: input.sources },
    status: 'succeeded',
    result,
    error_code: null,
    created_at: '2030-01-01T00:00:00Z',
    updated_at: '2030-01-01T00:00:00Z',
  });
  const replay = await h.repo.begin(principal, workId, input);
  assert.equal(replay.claimed, false);
  assert.equal(Object.hasOwn(replay.record.material, 'scope'), false);
  assert.deepEqual(replay.record.result, result);
  assert.equal(h.inserts, 0);
});
test('explicit UI scope overrides suggestion; uncertain service input remains world-compatible', async () => {
  const explicit = await harness().repo.begin(principal, workId, { ...input, scope: 'world' });
  assert.equal(explicit.record.material.scope, 'world');
  const uncertain = await harness().repo.begin(principal, workId, {
    ...input,
    sources: [{ filename: '草稿.md', content: '散文' }],
  });
  assert.equal(uncertain.record.material.scope, 'world');
});
