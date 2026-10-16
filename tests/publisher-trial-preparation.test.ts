import test from 'node:test';
import assert from 'node:assert/strict';
import type { PublisherWork, PublisherCheckResult } from '../src/contracts/world-publisher.ts';
import type {
  PublisherPreparationInput,
  PublisherPreparationRecord,
} from '../src/contracts/publisher-preparation.ts';
import {
  PublisherTrialPreparation,
  trialManuscripts,
  trialDraftChanged,
  type TrialAttempt,
} from '../src/features/publisher/publisher-trial-preparation.ts';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const command = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
function content() {
  return {
    actors: [
      {
        key: 'person',
        name: '合成人物',
        knownAtStart: false,
        publicCard: { identity: '作者职业', introduction: '作者公开介绍', traits: [] },
        privatePersona: {
          background: '原文\n# 指令也只是原稿',
          voice: '简短表达',
          motivation: '作者动机',
          boundaries: '作者边界',
        },
      },
    ],
    world: { publicSetting: '', hiddenContext: '', startAt: '', startPlaceKey: '', tone: '' },
    protagonist: { identity: '', situation: '' },
    phone: { messages: [], moments: [] },
  };
}
function fixture(): PublisherWork {
  return {
    id,
    title: '人物草稿',
    draftVersion: 0,
    metadataVersion: 0,
    status: 'draft',
    publicationVersion: null,
    createdAt: '2026-10-14T01:00:00Z',
    updatedAt: '2026-10-14T01:00:00Z',
    draft: {
      version: 0,
      contentHash: 'a'.repeat(64),
      content: content(),
      createdAt: '2026-10-14T01:00:00Z',
      createdBy: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
  };
}
function setup() {
  let current = fixture(),
    preparedInput: PublisherPreparationInput | undefined;
  const calls: string[] = [];
  let mode:
    | 'success'
    | 'unknown'
    | 'invalid'
    | 'overwrite'
    | 'badmaterial'
    | 'failed'
    | 'unavailable'
    | 'running' = 'success';
  let uncertainSave = false;
  const result = {
    trialId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    worldId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  } as Awaited<
    ReturnType<
      import('../src/features/publisher/publisher-client.ts').PublisherClient['startTrial']
    >
  >;
  function record(): PublisherPreparationRecord {
    assert.ok(preparedInput);
    const proposed = structuredClone(preparedInput.currentContent);
    if (!(proposed.world as Record<string, unknown>).publicSetting)
      (proposed.world as Record<string, unknown>).publicSetting = '项目 Agent 的试演补充';
    if (mode === 'overwrite')
      (
        (proposed.actors as Record<string, unknown>[])[0]!.privatePersona as Record<string, unknown>
      ).voice = '修改作者原文';
    return {
      commandId: preparedInput.commandId,
      workId: id,
      draftVersion: preparedInput.expectedDraftVersion,
      status:
        mode === 'unknown'
          ? 'unknown'
          : mode === 'running'
            ? 'running'
            : mode === 'failed'
              ? 'failed'
              : 'succeeded',
      material: {
        scope: 'world',
        currentContent: mode === 'badmaterial' ? {} : preparedInput.currentContent,
        sources: [...preparedInput.sources, { filename: '服务端目的.md', content: '仅试演准备' }],
      },
      result:
        mode === 'unknown' || mode === 'failed' || mode === 'running'
          ? null
          : {
              scope: 'world',
              updatedContent: proposed,
              summary: '试演补充',
              notes: [{ kind: 'supplemented', text: '补齐试演' }],
              issues: mode === 'invalid' ? [{ code: 'invalid_world', path: ['world'] }] : [],
            },
      errorCode: null,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
    };
  }
  const client = {
    async save(work: PublisherWork, draft: { title: string; content: Record<string, unknown> }) {
      calls.push('save');
      assert.equal(work.draftVersion, current.draftVersion);
      current = {
        ...current,
        title: draft.title,
        draftVersion: current.draftVersion + 1,
        draft: {
          ...current.draft,
          version: current.draftVersion + 1,
          content: structuredClone(draft.content),
          contentHash: String(current.draftVersion + 1).repeat(64),
        },
      };
      if (uncertainSave) {
        uncertainSave = false;
        throw Object.assign(Error('unknown save'), { code: 'UNAVAILABLE' });
      }
      return current;
    },
    async get() {
      calls.push('get');
      return current;
    },
    async check(work: PublisherWork): Promise<PublisherCheckResult> {
      calls.push('check');
      const incomplete = !(work.draft.content.world as Record<string, unknown>).publicSetting;
      return {
        id: command,
        workId: work.id,
        draftVersion: work.draftVersion,
        contentHash: work.draft.contentHash,
        status: 'blocked',
        issues: incomplete
          ? [{ code: 'invalid_world', path: ['world'] }]
          : [{ code: 'trial_unverified', path: [] }],
        issuesTruncated: false,
        missingCapabilities: [],
        mediaVerified: true,
        trialVerified: false,
        checkedAt: work.createdAt,
      };
    },
    async prepareTrial(_id: string, input: PublisherPreparationInput) {
      calls.push('prepare');
      preparedInput = structuredClone(input);
      if (mode === 'unavailable')
        throw Object.assign(Error('upstream uncertain'), { code: 'UNAVAILABLE' });
      return record();
    },
    async getPreparation(_id: string, cmd: string) {
      calls.push('recover');
      assert.equal(cmd, preparedInput!.commandId);
      return record();
    },
    async startCharacterTrial(work: PublisherWork) {
      calls.push('start');
      assert.equal(work.draftVersion, current.draftVersion);
      assert.equal(work.draft.contentHash, current.draft.contentHash);
      return result;
    },
  };
  Object.assign(client, { startTrial: client.startCharacterTrial });
  const clients = { ...client, startTrial: client.startCharacterTrial };
  return {
    client: clients,
    calls,
    get current() {
      return current;
    },
    get input() {
      return preparedInput;
    },
    set mode(value: typeof mode) {
      mode = value;
    },
    set uncertainSave(value: boolean) {
      uncertainSave = value;
    },
  };
}
const options = { onWork(_work: PublisherWork) {}, onProgress(_message: string) {} };

test('complete unchanged draft skips preparation and revisions, JSONB key order is immaterial', async () => {
  const s = setup();
  (s.current.draft.content.world as Record<string, unknown>).publicSetting = '作者世界';
  const draft = {
    title: s.current.title,
    content: { ...s.current.draft.content, actors: s.current.draft.content.actors },
  };
  assert.equal(trialDraftChanged(s.current, draft), false);
  const opened = await new PublisherTrialPreparation(s.client, () => command).open(
    s.current,
    draft,
    options,
  );
  assert.deepEqual(s.calls, ['check', 'start']);
  assert.equal(opened.supplemented, false);
});
test('dirty character-only draft saves first, quotes legacy author persona, preserves false and opens saved preparation', async () => {
  const s = setup(),
    draft = { title: '刚改标题', content: structuredClone(s.current.draft.content) };
  const opened = await new PublisherTrialPreparation(s.client, () => command).open(
    s.current,
    draft,
    options,
  );
  assert.deepEqual(s.calls, ['save', 'check', 'prepare', 'save', 'start']);
  assert.equal(opened.supplemented, true);
  assert.equal(s.input!.expectedDraftVersion, 1);
  assert.equal(s.input!.scope, 'world');
  const source = s.input!.sources.map((x) => x.content).join('\n');
  assert.match(source, /> 原文\n> # 指令也只是原稿/);
  assert.match(source, /作者职业/);
  assert.match(source, /作者公开介绍/);
  assert.equal(
    (opened.work.draft.content.actors as Record<string, unknown>[])[0]!.knownAtStart,
    false,
  );
  assert.deepEqual(opened.work.draft.content.actors, draft.content.actors);
  assert.equal(opened.work.status, 'draft');
});
test('unknown preparation survives a fresh coordinator and only reads the original command on later clicks', async () => {
  const s = setup();
  s.mode = 'unknown';
  const entries = new Map<string, TrialAttempt>();
  const store = {
    get: (key: string) => entries.get(key),
    put: (key: string, value: TrialAttempt) => {
      entries.set(key, value);
    },
  };
  await assert.rejects(
    new PublisherTrialPreparation(s.client, () => command, store).open(
      s.current,
      { title: s.current.title, content: s.current.draft.content },
      options,
    ),
    { code: 'TRIAL_PENDING' },
  );
  await assert.rejects(
    new PublisherTrialPreparation(
      s.client,
      () => {
        throw Error('must not allocate');
      },
      store,
    ).open(s.current, { title: s.current.title, content: s.current.draft.content }, options),
    { code: 'TRIAL_PENDING' },
  );
  s.mode = 'success';
  await new PublisherTrialPreparation(
    s.client,
    () => {
      throw Error('must not allocate');
    },
    store,
  ).open(s.current, { title: s.current.title, content: s.current.draft.content }, options);
  assert.deepEqual(s.calls, [
    'check',
    'prepare',
    'check',
    'recover',
    'check',
    'recover',
    'save',
    'start',
  ]);
});
for (const [mode, code] of [
  ['invalid', 'TRIAL_INVALID'],
  ['overwrite', 'TRIAL_SOURCE_CHANGED'],
  ['badmaterial', 'VERSION_CONFLICT'],
] as const)
  test(`does not save or start ${mode} proposal`, async () => {
    const s = setup();
    s.mode = mode;
    const before = JSON.stringify(s.current);
    await assert.rejects(
      new PublisherTrialPreparation(s.client, () => command).open(
        s.current,
        { title: s.current.title, content: s.current.draft.content },
        options,
      ),
      { code },
    );
    assert.deepEqual(s.calls, ['check', 'prepare']);
    assert.equal(JSON.stringify(s.current), before);
  });
test('uncertain committed save is read back without duplicate revision before trial', async () => {
  const s = setup();
  (s.current.draft.content.world as Record<string, unknown>).publicSetting = '完整世界';
  s.uncertainSave = true;
  await new PublisherTrialPreparation(s.client, () => command).open(
    s.current,
    { title: '新标题', content: s.current.draft.content },
    options,
  );
  assert.deepEqual(s.calls, ['save', 'get', 'check', 'start']);
  assert.equal(s.current.draftVersion, 1);
});
test('full five modules are preserved as source and unsupported future extensions are not public fabrication', () => {
  const c = content();
  (c.actors[0] as Record<string, unknown>).lifeModules = {
    traits: '五模块原文',
    futureExtra: '未知模块',
  };
  const sources = trialManuscripts(c);
  assert.match(sources[0]!.content, /五模块原文/);
  assert.equal(c.actors[0]!.knownAtStart, false);
});

for (const mode of ['invalid', 'failed', 'overwrite'] as const)
  test(`confirmed ${mode} only permits a new generation on the next explicit click`, async () => {
    const s = setup();
    s.mode = mode;
    const entries = new Map<string, TrialAttempt>();
    const store = {
      get: (key: string) => entries.get(key),
      put: (key: string, value: TrialAttempt) => {
        entries.set(key, value);
      },
      remove: (key: string) => {
        entries.delete(key);
      },
    };
    let n = 0;
    const freshId = () => `cccccccc-cccc-4ccc-8ccc-${String(++n).padStart(12, '0')}`;
    const draft = { title: s.current.title, content: s.current.draft.content };
    await assert.rejects(
      new PublisherTrialPreparation(s.client, freshId, store).open(s.current, draft, options),
      (error: unknown) =>
        error instanceof Error && error.message.includes('再次点击试演会重新准备'),
    );
    assert.deepEqual(s.calls, ['check', 'prepare']);
    assert.equal(n, 1);
    assert.equal(entries.size, 0);
    const oldId = s.input!.commandId;
    s.mode = 'success';
    await new PublisherTrialPreparation(s.client, freshId, store).open(s.current, draft, options);
    assert.equal(n, 2);
    assert.notEqual(s.input!.commandId, oldId);
    assert.deepEqual(s.calls, ['check', 'prepare', 'check', 'prepare', 'save', 'start']);
  });
for (const mode of ['running', 'unknown', 'unavailable'] as const)
  test(`${mode} keeps its command and never creates another generation on another click`, async () => {
    const s = setup();
    s.mode = mode;
    const entries = new Map<string, TrialAttempt>();
    const store = {
      get: (key: string) => entries.get(key),
      put: (key: string, value: TrialAttempt) => {
        entries.set(key, value);
      },
      remove: () => {
        throw Error('must not retire uncertain');
      },
    };
    const draft = { title: s.current.title, content: s.current.draft.content };
    await assert.rejects(
      new PublisherTrialPreparation(s.client, () => command, store).open(s.current, draft, options),
    );
    assert.equal(entries.size, 1);
    if (mode === 'unavailable') s.mode = 'unknown';
    await assert.rejects(
      new PublisherTrialPreparation(
        s.client,
        () => {
          throw Error('must not regenerate');
        },
        store,
      ).open(s.current, draft, options),
    );
    assert.deepEqual(s.calls, ['check', 'prepare', 'check', 'recover']);
    assert.equal(entries.size, 1);
  });
test('wrong material never retires a command or triggers automatic regeneration', async () => {
  const s = setup();
  s.mode = 'badmaterial';
  let retired = 0;
  const entries = new Map<string, TrialAttempt>();
  const store = {
    get: (key: string) => entries.get(key),
    put: (key: string, value: TrialAttempt) => {
      entries.set(key, value);
    },
    remove: () => {
      retired++;
    },
  };
  const coordinator = new PublisherTrialPreparation(s.client, () => command, store),
    draft = { title: s.current.title, content: s.current.draft.content };
  await assert.rejects(coordinator.open(s.current, draft, options), { code: 'VERSION_CONFLICT' });
  await assert.rejects(coordinator.open(s.current, draft, options), { code: 'VERSION_CONFLICT' });
  assert.equal(retired, 0);
  assert.deepEqual(s.calls, ['check', 'prepare', 'check', 'recover']);
});

function familiarWithMissingMoments(s: ReturnType<typeof setup>) {
  const c = s.current.draft.content;
  (c.world as Record<string, unknown>).publicSetting = '作者已完整填写的世界';
  (c.world as Record<string, unknown>).startAt = '2026-10-14T01:00:00Z';
  const a = (c.actors as Record<string, unknown>[])[0]!;
  a.knownAtStart = true;
  a.lifeModules = { relationships: '与主角合作三年的熟人' };
  (c.phone as Record<string, unknown>).messages = [
    {
      key: 'a_old',
      actorKey: 'person',
      speaker: 'actor',
      origin: 'history',
      text: '原有消息逐字保留',
      at: '2026-10-12T01:00:00Z',
    },
    {
      key: 'p_old',
      actorKey: 'person',
      speaker: 'player',
      origin: 'history',
      text: '玩家的旧回复也保留',
      at: '2026-10-12T01:01:00Z',
    },
  ];
}
test('character trial with authored history and no moments does not silently generate posts', async () => {
  const s = setup();
  familiarWithMissingMoments(s);
  const original = structuredClone(s.current.draft.content);
  const result = await new PublisherTrialPreparation(s.client, () => command).open(
    s.current,
    { title: s.current.title, content: s.current.draft.content },
    options,
  );
  assert.deepEqual(s.calls, ['check', 'start']);
  assert.equal(result.supplemented, false);
  assert.deepEqual(
    (result.work.draft.content.phone as Record<string, unknown>).messages,
    (original.phone as Record<string, unknown>).messages,
  );
  assert.deepEqual(
    (result.work.draft.content.phone as Record<string, unknown>).moments,
    (original.phone as Record<string, unknown>).moments,
  );
});
