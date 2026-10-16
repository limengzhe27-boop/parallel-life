import test from 'node:test';
import assert from 'node:assert/strict';
import { lazyPublicationManuscriptPlanner } from '../src/server/publisher-manuscript-composition.ts';
import { preparePublisherManuscript } from '../src/modules/settings/application/publisher-preparation.ts';
import type { PublisherPreparationRecord } from '../src/contracts/publisher-preparation.ts';

test('the HTTP planner assembly receives the persisted reference, fills dates, and stays lazy on replay', async () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const referenceAt = '2031-03-06T10:00:00.000Z';
  const input = {
    commandId: id(1),
    expectedDraftVersion: 0,
    scope: 'world' as const,
    currentContent: {},
    sources: [{ filename: '原稿.md', content: '两位成年朋友经营一间家具工作室。' }],
  };
  let record: PublisherPreparationRecord = {
    commandId: input.commandId,
    workId: id(2),
    draftVersion: 0,
    status: 'running',
    material: { scope: input.scope, currentContent: input.currentContent, sources: input.sources },
    result: null,
    errorCode: null,
    createdAt: referenceAt,
    updatedAt: referenceAt,
  };
  let fresh = true;
  let factories = 0;
  let calls = 0;
  const planner = lazyPublicationManuscriptPlanner(() => {
    factories++;
    return {
      async complete(messages, signal) {
        calls++;
        assert.ok(signal);
        const request = JSON.parse(messages[1]!.content);
        assert.equal(request.scheduling.referenceAt, referenceAt);
        assert.equal(request.previewReferenceAt, referenceAt);
        return JSON.stringify({
          summary: '待核对的普通开场',
          notes: [],
          updatedContent: {
            schemaVersion: 1,
            work: {
              key: 'test',
              title: '工作室',
              hook: '两位朋友',
              description: '工作室的日常',
              experienceNote: '虚构世界体验',
            },
            world: {
              publicSetting: '家具工作室',
              tone: '日常',
              startAt: '',
              startPlaceKey: 'home',
              hiddenContext: '作者安排后续变化',
            },
            protagonist: { identity: '合伙人', situation: '整理工具', knownFactKeys: [] },
            actors: ['a', 'b'].map((key) => ({
              key,
              name: key,
              knownAtStart: true,
              publicCard: { traits: [] },
              privatePersona: {
                background: '成年合伙人',
                motivation: '做好作品',
                voice: '直接',
                boundaries: '尊重选择',
              },
            })),
            places: [{ key: 'home', name: '工作室', description: '存放工具', knownAtStart: true }],
            routes: [],
            relationships: [],
            history: [],
            initialKnowledge: [],
            phone: {
              messages: [
                { key: 'old', actorKey: 'a', origin: 'history', text: '工具收好了。', at: '' },
              ],
              moments: [{ key: 'post', actorKey: 'a', text: '收拾好工具。', at: '' }],
              notes: [],
              invitations: [],
              album: [],
            },
            media: [],
            candidates: [],
            extensions: [],
          },
        });
      },
    };
  });
  const store = {
    async begin() {
      const claimed = fresh;
      fresh = false;
      return { record, claimed };
    },
    async read() {
      return record;
    },
    async finish(
      _principal: string,
      _work: string,
      _command: string,
      outcome: Pick<PublisherPreparationRecord, 'status' | 'result' | 'errorCode'>,
    ) {
      record = { ...record, ...outcome };
      return record;
    },
  };
  assert.equal(factories, 0);
  const first = await preparePublisherManuscript(store, planner, id(3), id(2), input);
  assert.equal(first.status, 'succeeded');
  assert.deepEqual(first.result?.issues, []);
  const content = first.result!.updatedContent as {
    world: { startAt: string };
    phone: { messages: { at: string }[]; moments: { at: string }[] };
  };
  assert.equal(content.world.startAt, referenceAt);
  assert.ok(Date.parse(content.phone.messages[0]!.at) < Date.parse(referenceAt));
  assert.ok(Date.parse(content.phone.moments[0]!.at) <= Date.parse(referenceAt));
  assert.equal(first.result?.schedule?.status, 'proposed');
  assert.equal(calls, 1, 'missing dates are filled without another model call');
  assert.deepEqual(await preparePublisherManuscript(store, planner, id(3), id(2), input), first);
  assert.equal(factories, 1, 'cached replay does not initialize a provider');
  assert.equal(calls, 1);
});
