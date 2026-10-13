import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PublisherPreparationMaterialSchema } from '../src/contracts/publisher-preparation.ts';
import {
  preparePublisherManuscript,
  type PublisherPreparationStore,
} from '../src/modules/settings/application/publisher-preparation.ts';

test('manuscript budget rejects oversized combined sources before sending; unknown draft data remains intact', () => {
  const currentContent = { extensions: [{ privateFuture: { kept: true } }] };
  const parsed = PublisherPreparationMaterialSchema.parse({
    currentContent,
    sources: [{ filename: '原稿.md', content: '一个虚构起点' }],
  });
  assert.deepEqual(parsed.currentContent, currentContent);
  assert.equal(
    PublisherPreparationMaterialSchema.safeParse({
      currentContent: {},
      sources: [{ filename: '超限.md', content: 'a'.repeat(48000) }],
    }).success,
    false,
  );
  assert.equal(
    PublisherPreparationMaterialSchema.safeParse({
      currentContent: {},
      sources: Array.from({ length: 33 }, () => ({ filename: 'a', content: 'b' })),
    }).success,
    false,
  );
});
test('non-JSON draft does not execute an accessor while calculating the budget', () => {
  let reads = 0;
  const content = {};
  Object.defineProperty(content, 'secret', {
    enumerable: true,
    get() {
      reads++;
      return 'private';
    },
  });
  assert.equal(
    PublisherPreparationMaterialSchema.safeParse({
      currentContent: content,
      sources: [{ filename: 'a', content: 'b' }],
    }).success,
    false,
  );
  assert.equal(reads, 0);
});
test('paid success followed by persistence failure is not changed to failed or reissued on replay', async () => {
  const input = {
    commandId: randomUUID(),
    expectedDraftVersion: 0,
    currentContent: {},
    sources: [{ filename: '剧本.md', content: '虚构' }],
  };
  const workId = randomUUID(),
    principal = randomUUID();
  let begun = false,
    calls = 0,
    finishes = 0;
  const record = {
    commandId: input.commandId,
    workId,
    draftVersion: 0,
    material: { currentContent: {}, sources: input.sources },
    status: 'running' as const,
    result: null,
    errorCode: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const store: PublisherPreparationStore = {
    async begin() {
      const claimed = !begun;
      begun = true;
      return { record, claimed };
    },
    async read() {
      return record;
    },
    async finish() {
      finishes++;
      throw Error('connection lost after paid response');
    },
  };
  const planner = {
    async propose() {
      calls++;
      return { updatedContent: {}, summary: '待核对', notes: [], issues: [] };
    },
  };
  await assert.rejects(preparePublisherManuscript(store, planner, principal, workId, input));
  assert.equal(
    (await preparePublisherManuscript(store, planner, principal, workId, input)).status,
    'running',
  );
  assert.equal(calls, 1);
  assert.equal(finishes, 1);
});

test('preparation reference is the admitted record time, never request or retry time', async () => {
  const input = {
    commandId: randomUUID(),
    expectedDraftVersion: 0,
    currentContent: {},
    sources: [{ filename: 'a.md', content: '虚构故事' }],
  };
  const record = {
    commandId: input.commandId,
    workId: randomUUID(),
    draftVersion: 0,
    material: { currentContent: {}, sources: input.sources },
    status: 'running' as const,
    result: null,
    errorCode: null,
    createdAt: '2032-01-03T01:00:00.000Z',
    updatedAt: '2032-01-04T01:00:00.000Z',
  };
  let reference: string | undefined;
  const store: PublisherPreparationStore = {
    async begin() {
      return { record, claimed: true };
    },
    async read() {
      return record;
    },
    async finish(_p, _w, _c, outcome) {
      return { ...record, ...outcome };
    },
  };
  await preparePublisherManuscript(
    store,
    {
      async propose(_m, _s, context) {
        reference = context?.referenceAt;
        return { updatedContent: {}, summary: '合成提案', notes: [], issues: [] };
      },
    },
    randomUUID(),
    record.workId,
    input,
  );
  assert.equal(reference, record.createdAt);
});
