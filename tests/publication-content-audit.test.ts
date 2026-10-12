import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PublishedWorldContentSchema,
  previewPublishedWorldContent,
  inspectPublishedWorldSupport,
} from '../src/contracts/published-world-content.ts';
import {
  publicationContentIssues,
  publicationPlayerPreview,
  publicationStorageIssues,
  publicationSupport,
  type PublicationContent,
} from '../src/modules/settings/domain/publication-content.ts';

// Independent synthetic authoring fixture, not imported from the implementation tests.
// Calls actual frozen schema/preview/support functions; no repository, API or model success claim.
function fixture(): PublicationContent {
  return {
    schemaVersion: 1,
    work: {
      key: 'qa_work',
      title: '旧站的一天',
      hook: '先商量今天的安排',
      description: '审核合成资料',
      experienceNote: '可以拒绝，尚未承诺',
      coverMediaKey: 'cover',
    },
    world: {
      publicSetting: '现代车站',
      tone: '平实',
      startAt: '2026-10-12T09:00:00Z',
      startPlaceKey: 'station',
      hiddenContext: 'SECRET_WORLD_CONTEXT',
    },
    protagonist: { identity: '站务员', situation: '刚开始值班', knownFactKeys: ['met_before'] },
    actors: [
      {
        key: 'a_first',
        name: '小周',
        knownAtStart: true,
        publicCard: { identity: '同事', traits: [], avatarMediaKey: 'avatar' },
        privatePersona: {
          background: 'SECRET_FIRST_BACKGROUND',
          motivation: 'SECRET_FIRST_MOTIVE',
          voice: '简短',
          boundaries: 'SECRET_FIRST_BOUNDARY',
        },
      },
      {
        key: 'a_other',
        name: '小周',
        knownAtStart: false,
        publicCard: { identity: 'SECRET_UNKNOWN_IDENTITY', traits: ['SECRET_UNKNOWN_TRAIT'] },
        privatePersona: {
          background: 'SECRET_SECOND_BACKGROUND',
          motivation: 'SECRET_SECOND_MOTIVE',
          voice: '慢慢说',
          boundaries: 'SECRET_SECOND_BOUNDARY',
        },
      },
    ],
    relationships: [
      {
        key: 'public_tie',
        from: { kind: 'player' },
        to: { kind: 'actor', actorKey: 'a_first' },
        description: '在车站认识',
        visibility: { kind: 'player' },
      },
      {
        key: 'hidden_tie',
        from: { kind: 'actor', actorKey: 'a_first' },
        to: { kind: 'actor', actorKey: 'a_other' },
        description: 'SECRET_RELATIONSHIP',
        visibility: { kind: 'actors', actorKeys: ['a_first'] },
      },
    ],
    places: [
      {
        key: 'station',
        name: '车站',
        description: '有公共候车区',
        knownAtStart: true,
        sceneMediaKey: 'scene',
      },
      {
        key: 'back_room',
        name: 'SECRET_PLACE_NAME',
        description: 'SECRET_PLACE_DESCRIPTION',
        knownAtStart: false,
      },
    ],
    routes: [{ fromPlaceKey: 'station', toPlaceKey: 'back_room', minutes: 8 }],
    history: [
      {
        key: 'met_before',
        kind: 'established_fact',
        text: '开班前认识了同事',
        occurredAt: '2026-10-11T09:00:00Z',
        actorKeys: ['a_first'],
        placeKey: 'station',
        visibility: { kind: 'world' },
      },
      {
        key: 'hidden_fact',
        kind: 'established_fact',
        text: 'SECRET_HIDDEN_HISTORY',
        occurredAt: '2026-10-10T09:00:00Z',
        actorKeys: ['a_other'],
        placeKey: 'back_room',
        visibility: { kind: 'actors', actorKeys: ['a_other'] },
      },
      {
        key: 'visible_but_unknown',
        kind: 'established_fact',
        text: 'SECRET_NOT_KNOWN_AT_START',
        occurredAt: '2026-10-09T09:00:00Z',
        actorKeys: ['a_first'],
        visibility: { kind: 'world' },
      },
    ],
    initialKnowledge: [
      { actorKey: 'a_first', factKeys: ['met_before'] },
      { actorKey: 'a_other', factKeys: ['hidden_fact'] },
    ],
    phone: {
      messages: [
        {
          key: 'invite_message',
          actorKey: 'a_first',
          origin: 'incoming',
          text: '要不要下午一起整理值班表？',
          at: '2026-10-12T08:59:00Z',
        },
        {
          key: 'old_message',
          actorKey: 'a_first',
          origin: 'history',
          text: '昨天认识了',
          at: '2026-10-11T09:00:00Z',
        },
      ],
      notes: [
        { key: 'public_note', title: '值班提醒', text: '先讨论安排', factKeys: ['met_before'] },
      ],
      invitations: [
        {
          key: 'proposed_meeting',
          actorKeys: ['a_first'],
          placeKey: 'station',
          messageKey: 'invite_message',
          title: '讨论值班表',
          at: '2026-10-12T10:00:00Z',
          status: 'proposed',
        },
      ],
      album: [
        {
          key: 'past_photo',
          mediaKey: 'album',
          title: '昨天的候车区',
          historyFactKey: 'met_before',
        },
      ],
    },
    media: [
      {
        key: 'cover',
        asset: { namespace: 'publication', key: 'cover_asset', revision: 1 },
        use: 'cover',
        depiction: 'illustration',
        label: '原创封面',
        visibility: { kind: 'world' },
      },
      {
        key: 'avatar',
        asset: { namespace: 'publication', key: 'avatar_asset', revision: 2 },
        use: 'avatar',
        depiction: 'uploaded_image',
        label: '授权人物图片',
        visibility: { kind: 'player' },
      },
      {
        key: 'scene',
        asset: { namespace: 'publication', key: 'scene_asset', revision: 1 },
        use: 'scene',
        depiction: 'illustration',
        label: '候车区插画',
        visibility: { kind: 'world' },
      },
      {
        key: 'album',
        asset: { namespace: 'publication', key: 'album_asset', revision: 3 },
        use: 'album',
        depiction: 'uploaded_image',
        label: '剧中已有照片',
        visibility: { kind: 'player' },
      },
      {
        key: 'unreferenced_secret',
        asset: { namespace: 'publication', key: 'secret_asset', revision: 1 },
        use: 'scene',
        depiction: 'uploaded_image',
        label: 'SECRET_MEDIA_LABEL',
        visibility: { kind: 'actors', actorKeys: ['a_other'] },
      },
    ],
    candidates: [
      {
        key: 'later_opportunity',
        kind: 'candidate',
        title: 'SECRET_FUTURE_NODE',
        editorialIntent: 'SECRET_EDITORIAL_DIRECTION',
        actorKeys: ['a_first'],
        placeKey: 'station',
        prerequisites: [{ kind: 'history_fact', factKey: 'met_before' }],
        mutuallyExclusiveNodeKeys: [],
        intent: { kind: 'offer_message', actorKey: 'a_first', text: '未来可以提议调整排班' },
      },
    ],
    extensions: [
      {
        namespace: 'author.qa',
        version: 1,
        purpose: 'editorial',
        description: 'SECRET_EXTENSION_DESCRIPTION',
        data: { unknownFutureField: 'SECRET_EXTENSION_DATA' },
      },
    ],
  };
}
function withData(data: unknown): unknown {
  const c = fixture();
  return { ...c, extensions: [{ ...c.extensions[0], data }] };
}
function mustReject(raw: unknown) {
  assert.equal(PublishedWorldContentSchema.safeParse(raw).success, false);
  assert.throws(() => previewPublishedWorldContent(raw));
  assert.throws(() => inspectPublishedWorldSupport(raw));
}
function visibleStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(visibleStrings);
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([key, v]) => [key, ...visibleStrings(v)]);
  return [];
}
function noHidden(c: PublicationContent, markers: readonly string[]) {
  const parsed = PublishedWorldContentSchema.parse(c);
  const boundary = previewPublishedWorldContent(c),
    domain = publicationPlayerPreview(parsed);
  assert.deepEqual(domain, boundary);
  const values = visibleStrings(boundary);
  for (const marker of markers) assert.ok(!values.includes(marker), 'Preview exposed ' + marker);
  return boundary;
}

test('independent fixture is valid; safe preview excludes unrecognized actor/place/history/media and private content', () => {
  const c = fixture(),
    before = structuredClone(c);
  const p = noHidden(c, [
    'SECRET_WORLD_CONTEXT',
    'SECRET_FIRST_BACKGROUND',
    'SECRET_FIRST_MOTIVE',
    'SECRET_FIRST_BOUNDARY',
    'SECRET_SECOND_BACKGROUND',
    'SECRET_SECOND_MOTIVE',
    'SECRET_SECOND_BOUNDARY',
    'a_other',
    'SECRET_UNKNOWN_IDENTITY',
    'SECRET_UNKNOWN_TRAIT',
    'back_room',
    'SECRET_PLACE_NAME',
    'SECRET_PLACE_DESCRIPTION',
    'hidden_fact',
    'SECRET_HIDDEN_HISTORY',
    'visible_but_unknown',
    'SECRET_NOT_KNOWN_AT_START',
    'hidden_tie',
    'SECRET_RELATIONSHIP',
    'unreferenced_secret',
    'secret_asset',
    'SECRET_MEDIA_LABEL',
    'later_opportunity',
    'SECRET_FUTURE_NODE',
    'SECRET_EDITORIAL_DIRECTION',
    'author.qa',
    'SECRET_EXTENSION_DESCRIPTION',
    'SECRET_EXTENSION_DATA',
  ]);
  assert.equal(p.kind, 'authoring_preview');
  assert.equal(p.phone.invitations[0]?.status, 'proposed');
  assert.deepEqual(c, before);
});
test('public relationship to unknown actor is not a backdoor into its profile or stable key', () => {
  const c = fixture();
  c.relationships[1]!.visibility = { kind: 'world' };
  noHidden(c, ['hidden_tie', 'a_other', 'SECRET_RELATIONSHIP', 'SECRET_UNKNOWN_IDENTITY']);
});
test('unknown actor avatar and unknown place scene do not leak when their media is otherwise player-visible', () => {
  const c = fixture();
  c.actors[1]!.publicCard.avatarMediaKey = 'unknown_avatar';
  c.places[1]!.sceneMediaKey = 'unknown_scene';
  c.media.push(
    {
      key: 'unknown_avatar',
      asset: { namespace: 'publication', key: 'unknown_avatar_asset', revision: 1 },
      use: 'avatar',
      depiction: 'illustration',
      label: 'SECRET_UNKNOWN_AVATAR',
      visibility: { kind: 'player' },
    },
    {
      key: 'unknown_scene',
      asset: { namespace: 'publication', key: 'unknown_scene_asset', revision: 1 },
      use: 'scene',
      depiction: 'illustration',
      label: 'SECRET_UNKNOWN_SCENE',
      visibility: { kind: 'world' },
    },
  );
  noHidden(c, [
    'unknown_avatar',
    'unknown_scene',
    'unknown_avatar_asset',
    'unknown_scene_asset',
    'SECRET_UNKNOWN_AVATAR',
    'SECRET_UNKNOWN_SCENE',
  ]);
});
test('same-named public people retain distinct references and never inherit each other persona', () => {
  const c = fixture();
  c.actors[1]!.knownAtStart = true;
  c.actors[1]!.publicCard = { identity: '另一位同名值班员', traits: [] };
  const p = noHidden(c, [
    'SECRET_SECOND_BACKGROUND',
    'SECRET_SECOND_MOTIVE',
    'SECRET_FIRST_BACKGROUND',
  ]);
  assert.deepEqual(
    p.actors.map((a) => [a.key, a.name]),
    [
      ['a_first', '小周'],
      ['a_other', '小周'],
    ],
  );
  assert.equal(p.phone.messages[0]?.actorKey, 'a_first');
  assert.deepEqual(p.phone.invitations[0]?.actorKeys, ['a_first']);
});
test('player-visible history still does not enter preview until explicitly known at start', () => {
  const c = fixture();
  const p = noHidden(c, ['SECRET_NOT_KNOWN_AT_START', 'visible_but_unknown']);
  assert.deepEqual(
    p.history.map((h) => h.key),
    ['met_before'],
  );
});

const privateRefs: [string, (c: PublicationContent) => void][] = [
  [
    'protagonist known fact',
    (c) => {
      c.protagonist.knownFactKeys.push('hidden_fact');
    },
  ],
  [
    'note fact',
    (c) => {
      c.phone.notes[0]!.factKeys = ['hidden_fact'];
    },
  ],
  [
    'album source',
    (c) => {
      c.phone.album[0]!.historyFactKey = 'hidden_fact';
    },
  ],
  [
    'visible-but-unknown note fact',
    (c) => {
      c.phone.notes[0]!.factKeys = ['visible_but_unknown'];
    },
  ],
  [
    'visible-but-unknown album fact',
    (c) => {
      c.phone.album[0]!.historyFactKey = 'visible_but_unknown';
    },
  ],
  [
    'another actor private knowledge',
    (c) => {
      c.initialKnowledge[0]!.factKeys = ['hidden_fact'];
    },
  ],
  [
    'unknown sender',
    (c) => {
      c.phone.messages[0]!.actorKey = 'a_other';
    },
  ],
  [
    'unknown invitation participant',
    (c) => {
      c.phone.invitations[0]!.actorKeys = ['a_first', 'a_other'];
    },
  ],
  [
    'unknown invitation place',
    (c) => {
      c.phone.invitations[0]!.placeKey = 'back_room';
    },
  ],
  [
    'cover actor visibility',
    (c) => {
      c.media[0]!.visibility = { kind: 'actors', actorKeys: ['a_first'] };
    },
  ],
  [
    'avatar actor visibility',
    (c) => {
      c.media[1]!.visibility = { kind: 'actors', actorKeys: ['a_first'] };
    },
  ],
  [
    'scene actor visibility',
    (c) => {
      c.media[2]!.visibility = { kind: 'actors', actorKeys: ['a_first'] };
    },
  ],
  [
    'album actor visibility',
    (c) => {
      c.media[3]!.visibility = { kind: 'actors', actorKeys: ['a_first'] };
    },
  ],
  [
    'cover wrong use',
    (c) => {
      c.work.coverMediaKey = 'avatar';
    },
  ],
  [
    'invitation mismatched source sender',
    (c) => {
      c.actors[1]!.knownAtStart = true;
      c.phone.invitations[0]!.actorKeys = ['a_other'];
    },
  ],
  [
    'invitation missing source',
    (c) => {
      c.phone.invitations[0]!.messageKey = 'no_source';
    },
  ],
];
for (const [name, change] of privateRefs)
  test('cross-reference rejects: ' + name, () => {
    const c = fixture();
    change(c);
    mustReject(c);
  });

const chronology: [string, (c: PublicationContent) => void][] = [
  [
    'history after world start',
    (c) => {
      c.history[0]!.occurredAt = '2026-10-12T09:00:01Z';
    },
  ],
  [
    'future opening message',
    (c) => {
      c.phone.messages[0]!.at = '2026-10-12T09:00:01Z';
    },
  ],
  [
    'history message at start',
    (c) => {
      c.phone.messages[1]!.at = c.world.startAt;
    },
  ],
  [
    'invitation before start',
    (c) => {
      c.phone.invitations[0]!.at = '2026-10-12T08:59:59Z';
    },
  ],
  [
    'invalid real calendar date',
    (c) => {
      c.history[0]!.occurredAt = '2026-02-30T09:00:00Z';
    },
  ],
  [
    'node earliest before start',
    (c) => {
      c.candidates[0]!.intent = {
        kind: 'offer_invitation',
        actorKeys: ['a_first'],
        placeKey: 'station',
        title: '邀请',
        earliestAt: '2026-10-12T08:00:00Z',
      };
    },
  ],
  [
    'node self dependency',
    (c) => {
      c.candidates[0]!.prerequisites = [
        { kind: 'after_committed_node', nodeKey: 'later_opportunity' },
      ];
    },
  ],
  [
    'node missing committed predecessor',
    (c) => {
      c.candidates[0]!.prerequisites = [{ kind: 'after_committed_node', nodeKey: 'not_existing' }];
    },
  ],
];
for (const [name, change] of chronology)
  test('source/time boundary rejects: ' + name, () => {
    const c = fixture();
    change(c);
    mustReject(c);
  });
test('past established fact at start is stored as authored history, not a completed live command', () => {
  const c = fixture();
  c.history[0]!.occurredAt = c.world.startAt;
  const p = previewPublishedWorldContent(c);
  assert.equal(p.kind, 'authoring_preview');
  assert.equal(p.phone.invitations[0]?.status, 'proposed');
  assert.ok(!('commandReceipt' in p));
});
test('acyclic predecessor only stores a condition; no executed node or eligibility appears', () => {
  const c = fixture();
  c.candidates.push({
    ...structuredClone(c.candidates[0]!),
    key: 'after_later',
    prerequisites: [{ kind: 'after_committed_node', nodeKey: 'later_opportunity' }],
    intent: { kind: 'editorial_only' },
  });
  const parsed = PublishedWorldContentSchema.parse(c),
    p = previewPublishedWorldContent(c);
  assert.equal(parsed.candidates.length, 2);
  assert.equal(parsed.history.length, 3);
  assert.equal(p.history.length, 1);
  assert.ok(!('candidates' in p));
  assert.ok(!('eligibleNodes' in p));
});
test('indirect prerequisite cycle rejects rather than becoming mandatory traversal', () => {
  const c = fixture();
  c.candidates[0]!.prerequisites = [{ kind: 'after_committed_node', nodeKey: 'second' }];
  c.candidates.push({
    ...structuredClone(c.candidates[0]!),
    key: 'second',
    prerequisites: [{ kind: 'after_committed_node', nodeKey: 'later_opportunity' }],
  });
  mustReject(c);
});

test('knownAtStart and a complete adapter capability set still grant no publication authority', () => {
  const c = fixture();
  c.actors[1]!.knownAtStart = true;
  const stored = PublishedWorldContentSchema.parse(c);
  const blocked = inspectPublishedWorldSupport(stored);
  assert.equal(blocked.runtimeReady, false);
  assert.equal(blocked.grantsPublicationAuthority, false);
  const capabilities = new Set(blocked.requiredCapabilities),
    enabled = inspectPublishedWorldSupport(stored, capabilities);
  assert.equal(enabled.runtimeReady, true);
  assert.equal(enabled.grantsPublicationAuthority, false);
  assert.deepEqual(enabled, publicationSupport(stored, capabilities));
});
test('unknown runtime-required extension remains unsupported even if its name is in the capability registry', () => {
  const c = fixture();
  c.extensions[0]!.purpose = 'runtime_required';
  const initial = inspectPublishedWorldSupport(c),
    caps = new Set([...initial.requiredCapabilities, 'author.qa']);
  const status = inspectPublishedWorldSupport(c, caps);
  assert.equal(status.runtimeReady, false);
  assert.equal(status.grantsPublicationAuthority, false);
  assert.deepEqual(status.unsupportedRuntimeExtensions, ['author.qa']);
});
test('editorial extension roundtrips exactly, stays internal, and is never an approved public/runtime field', () => {
  const c = fixture();
  c.extensions[0]!.data = {
    newMusicField: '秘密音乐',
    nested: [null, true, 9, { longForm: '未接线内容' }],
  };
  const parsed = PublishedWorldContentSchema.parse(c);
  assert.deepEqual(parsed.extensions, c.extensions);
  const p = noHidden(c, ['newMusicField', '秘密音乐', 'longForm', '未接线内容', 'author.qa']);
  assert.ok(!('extensions' in p));
  assert.equal(inspectPublishedWorldSupport(c).grantsPublicationAuthority, false);
});
test('caller cannot smuggle approval, completed state or schema evolution through strict content fields', () => {
  for (const raw of [
    { ...fixture(), schemaVersion: 2 },
    { ...fixture(), approved: true },
    { ...fixture(), world: { ...fixture().world, published: true } },
    {
      ...fixture(),
      phone: {
        ...fixture().phone,
        invitations: [{ ...fixture().phone.invitations[0], status: 'confirmed' }],
      },
    },
  ])
    mustReject(raw);
});
test('mutating preview fields cannot modify stored fact, actor, invitation or media reference', () => {
  const c = fixture(),
    p = previewPublishedWorldContent(c),
    before = structuredClone(c);
  p.actors[0]!.publicCard.traits.push('改过');
  p.phone.invitations[0]!.actorKeys.push('a_other');
  p.phone.album[0]!.image!.asset.revision = 999;
  p.history[0]!.text = '改过';
  assert.deepEqual(c, before);
});

const invalidJson: [string, () => unknown][] = [
  ['own prototype key', () => JSON.parse('{"__proto__":{"leak":true}}')],
  ['nested constructor key', () => JSON.parse('{"nested":{"constructor":{"leak":true}}}')],
  [
    'class instance',
    () =>
      new (class PrivateData {
        secret = 'value';
      })(),
  ],
  ['sparse array', () => Array(2)],
  ['array named property', () => Object.assign(['value'], { privateExtra: 'lost in stringify' })],
  ['nonenumerable field', () => Object.defineProperty({}, 'secret', { value: 'hidden' })],
  ['symbol own key', () => ({ [Symbol('private')]: 'hidden' })],
  [
    'function value',
    () => ({
      fn: () => {
        throw Error('must not run');
      },
    }),
  ],
  ['non-finite value', () => ({ number: Infinity })],
  ['undefined value', () => ({ unset: undefined })],
  [
    'cyclic object',
    () => {
      const data: { self?: unknown } = {};
      data.self = data;
      return data;
    },
  ],
  [
    'over-depth object',
    () => {
      let value: unknown = 'leaf';
      for (let n = 0; n < 20; n++) value = { next: value };
      return value;
    },
  ],
];
for (const [name, make] of invalidJson)
  test('actual JSON boundary rejects ' + name, () => {
    const raw = withData(make());
    assert.ok(publicationStorageIssues(raw).length > 0);
    mustReject(raw);
  });
test('own getter on source object is rejected before accessing hidden value', () => {
  let reads = 0;
  const c = fixture();
  Object.defineProperty(c.world, 'hiddenContext', {
    enumerable: true,
    get() {
      reads++;
      return 'getter secret';
    },
  });
  mustReject(c);
  assert.equal(reads, 0);
});
test('own array index getter and own serializer are rejected without executing user code', () => {
  let calls = 0;
  const array: string[] = [];
  Object.defineProperty(array, '0', {
    enumerable: true,
    get() {
      calls++;
      return 'secret';
    },
  });
  mustReject(withData(array));
  assert.equal(calls, 0);
  const ownSerializer = Object.defineProperty({}, 'toJSON', {
    value() {
      calls++;
      return 'changed';
    },
  });
  mustReject(withData(ownSerializer));
  assert.equal(calls, 0);
});
// Deliberately retain exact adversarial input/assertions when red; B is sole source owner.
test('array with inherited executable toJSON is rejected before serialization, not preserved as JSON', () => {
  let calls = 0;
  const data = ['source-value'];
  Object.setPrototypeOf(data, {
    toJSON() {
      calls++;
      return { changedByCode: 'SECRET_SERIALIZED_REPLACEMENT' };
    },
  });
  const raw = withData(data),
    stored = PublishedWorldContentSchema.safeParse(raw);
  assert.equal(calls, 0, 'validating internal JSON must not execute inherited serialization code');
  assert.equal(stored.success, false, 'non-JSON array prototype must reject');
});
test('array with inherited toJSON getter is rejected before executing hidden accessor', () => {
  let reads = 0;
  const data = ['source-value'];
  const prototype = Object.defineProperty({}, 'toJSON', {
    get() {
      reads++;
      return () => ({ changedByGetter: true });
    },
  });
  Object.setPrototypeOf(data, prototype);
  const raw = withData(data),
    stored = PublishedWorldContentSchema.safeParse(raw);
  assert.equal(reads, 0, 'validating internal JSON must not execute inherited toJSON getter');
  assert.equal(stored.success, false, 'non-JSON array prototype must reject');
});
test('null-prototype plain object is accepted as data without granting runtime support', () => {
  const data = Object.assign(Object.create(null) as Record<string, unknown>, {
    text: '普通资料',
    list: [1, true, null],
  });
  const raw = withData(data),
    stored = PublishedWorldContentSchema.parse(raw);
  assert.deepEqual(JSON.parse(JSON.stringify(stored.extensions[0]!.data)), {
    text: '普通资料',
    list: [1, true, null],
  });
  assert.equal(inspectPublishedWorldSupport(stored).runtimeReady, false);
});
test('UTF-8 extension budget rejects rather than truncates a Chinese document', () => {
  const raw = withData('汉'.repeat(3000));
  mustReject(raw);
});
test('total byte and JSON value limits reject before unbounded recursive shape parsing', () => {
  const raw = withData('界'.repeat(23000));
  assert.ok(publicationStorageIssues(raw).some((i) => i.code === 'content_budget'));
  mustReject(raw);
  const many = withData(Array.from({ length: 12001 }, () => null));
  assert.ok(publicationStorageIssues(many).some((i) => i.code === 'storage_values'));
  mustReject(many);
});

// Second audit phase targets exact fc6; the first 56 cases/input/assertions above stay unchanged.
const { publicationStoryWindowState } =
  await import('../src/modules/settings/domain/publication-content.ts');
function timedFixture(): PublicationContent {
  const c = fixture();
  c.timeline = {
    initialStageKey: 'shift_start',
    stages: [
      {
        key: 'shift_start',
        title: 'SECRET_OPENING_CHAPTER',
        order: 0,
        afterStageKeys: [],
        window: { notBefore: '2026-10-12T09:00:00Z', expiresAt: '2026-10-12T10:00:00Z' },
      },
      {
        key: 'later_shift',
        title: 'SECRET_LATER_CHAPTER',
        order: 2,
        afterStageKeys: ['shift_start'],
        window: { notBefore: '2026-10-12T10:00:00Z', expiresAt: '2026-10-12T15:00:00Z' },
      },
    ],
  };
  c.candidates[0]!.timeline = {
    stageKey: 'shift_start',
    window: { notBefore: '2026-10-12T09:15:00Z', expiresAt: '2026-10-12T09:45:00Z' },
    timeNote: 'SECRET_TIMELINE_AUTHOR_NOTE',
    excludeIfResolved: [],
    alternatives: {
      onDeclined: ['alternate_arrangement'],
      onSkipped: ['alternate_arrangement'],
      onExpired: ['alternate_arrangement'],
    },
  };
  c.candidates.push({
    key: 'alternate_arrangement',
    kind: 'candidate',
    title: 'SECRET_ALTERNATE_TITLE',
    editorialIntent: '需要合法结果和阶段才能提出',
    actorKeys: ['a_first'],
    placeKey: 'station',
    prerequisites: [
      {
        kind: 'after_resolved_node',
        nodeKey: 'later_opportunity',
        outcomes: ['declined', 'skipped', 'expired'],
      },
    ],
    mutuallyExclusiveNodeKeys: [],
    intent: { kind: 'editorial_only' },
    timeline: {
      stageKey: 'later_shift',
      window: { notBefore: '2026-10-12T10:00:00Z', expiresAt: '2026-10-12T14:00:00Z' },
      excludeIfResolved: [{ nodeKey: 'later_opportunity', outcomes: ['committed'] }],
      alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
    },
  });
  return c;
}
test('stage/skip metadata remains internal and never proves current eligibility or a saved outcome', () => {
  const c = timedFixture(),
    before = structuredClone(c);
  const p = noHidden(c, [
    'timeline',
    'stages',
    'shift_start',
    'later_shift',
    'alternate_arrangement',
    'SECRET_OPENING_CHAPTER',
    'SECRET_LATER_CHAPTER',
    'SECRET_ALTERNATE_TITLE',
    'SECRET_TIMELINE_AUTHOR_NOTE',
  ]);
  assert.deepEqual(c, before);
  assert.equal(p.history.length, 1);
  assert.ok(!('eligibleNodes' in p) && !('stageState' in p));
  assert.equal(p.phone.invitations[0]?.status, 'proposed');
});
test('parallel nodes and same-ranked independent stages are permitted without invented required traversal', () => {
  const c = timedFixture();
  c.timeline!.stages.push({
    key: 'parallel_stage',
    title: '并行人物线',
    order: 2,
    afterStageKeys: ['shift_start'],
  });
  c.candidates.push({
    ...structuredClone(c.candidates[0]!),
    key: 'independent_opportunity',
    prerequisites: [],
    timeline: {
      stageKey: 'shift_start',
      excludeIfResolved: [],
      alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
    },
  });
  const parsed = PublishedWorldContentSchema.parse(c);
  assert.equal(parsed.candidates.length, 3);
  assert.deepEqual(parsed.candidates[2]!.prerequisites, []);
});
test('explicit skipped outcome is an alternative prerequisite, never a substitute for required committed result', () => {
  const c = timedFixture();
  c.candidates[1]!.prerequisites = [
    { kind: 'after_resolved_node', nodeKey: 'later_opportunity', outcomes: ['skipped'] },
  ];
  const parsed = PublishedWorldContentSchema.parse(c);
  assert.deepEqual(parsed.candidates[1]!.prerequisites, [
    { kind: 'after_resolved_node', nodeKey: 'later_opportunity', outcomes: ['skipped'] },
  ]);
  assert.equal(parsed.history.length, fixture().history.length);
  assert.equal(inspectPublishedWorldSupport(parsed).runtimeReady, false);
});
test('an alternative pointer cannot turn an actual committed prerequisite into an already-satisfied skipped one', () => {
  const c = timedFixture();
  c.candidates[1]!.prerequisites = [{ kind: 'after_committed_node', nodeKey: 'later_opportunity' }];
  c.candidates[1]!.timeline!.excludeIfResolved = [];
  const parsed = PublishedWorldContentSchema.parse(c);
  assert.deepEqual(parsed.candidates[1]!.prerequisites, [
    { kind: 'after_committed_node', nodeKey: 'later_opportunity' },
  ]);
  assert.equal(parsed.candidates[0]!.timeline!.alternatives.onSkipped[0], 'alternate_arrangement');
  // Metadata can nominate the target, but no runtime engine or current outcome exists here.
  assert.equal(inspectPublishedWorldSupport(parsed).grantsPublicationAuthority, false);
  assert.ok(!('eligibleNodes' in previewPublishedWorldContent(parsed)));
});
test('partial outcome exclusion leaves a legitimate skipped path without forcing a decline', () => {
  const c = timedFixture();
  c.candidates[1]!.prerequisites = [
    {
      kind: 'after_resolved_node',
      nodeKey: 'later_opportunity',
      outcomes: ['declined', 'skipped'],
    },
  ];
  c.candidates[1]!.timeline!.excludeIfResolved = [
    { nodeKey: 'later_opportunity', outcomes: ['declined'] },
  ];
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
});
test('future invitation appointment can follow the candidate offer window without pretending the invitation already happened', () => {
  const c = timedFixture();
  c.candidates[0]!.intent = {
    kind: 'offer_invitation',
    actorKeys: ['a_first'],
    placeKey: 'station',
    title: '下午再讨论',
    earliestAt: '2026-10-12T11:00:00Z',
  };
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
  assert.equal(previewPublishedWorldContent(c).phone.invitations.length, 1);
});
const timelineFailures: [string, (c: PublicationContent) => void][] = [
  [
    'missing initial stage',
    (c) => {
      c.timeline!.initialStageKey = 'absent';
    },
  ],
  [
    'duplicate stage key',
    (c) => {
      c.timeline!.stages.push(structuredClone(c.timeline!.stages[0]!));
    },
  ],
  [
    'initial story time outside its stage',
    (c) => {
      c.timeline!.initialStageKey = 'later_shift';
    },
  ],
  [
    'unknown stage predecessor',
    (c) => {
      c.timeline!.stages[1]!.afterStageKeys = ['absent'];
    },
  ],
  [
    'self stage predecessor',
    (c) => {
      c.timeline!.stages[0]!.afterStageKeys = ['shift_start'];
    },
  ],
  [
    'same-rank necessary predecessor',
    (c) => {
      c.timeline!.stages[1]!.order = 0;
    },
  ],
  [
    'cyclic stages',
    (c) => {
      c.timeline!.stages[0]!.afterStageKeys = ['later_shift'];
    },
  ],
  [
    'declared timeline with an unassigned candidate',
    (c) => {
      delete c.candidates[0]!.timeline;
    },
  ],
  [
    'candidate timeline without world timeline',
    (c) => {
      delete c.timeline;
    },
  ],
  [
    'candidate stage reference missing',
    (c) => {
      c.candidates[0]!.timeline!.stageKey = 'absent';
    },
  ],
  [
    'empty effective window',
    (c) => {
      c.candidates[0]!.timeline!.window!.expiresAt = '2026-10-12T09:15:00Z';
    },
  ],
  [
    'node window outside stage',
    (c) => {
      c.candidates[0]!.timeline!.window!.expiresAt = '2026-10-12T10:01:00Z';
    },
  ],
  [
    'candidate entirely expired at world start',
    (c) => {
      c.timeline!.stages[0]!.window = {
        notBefore: '2026-10-12T08:00:00Z',
        expiresAt: '2026-10-12T10:00:00Z',
      };
      c.candidates[0]!.timeline!.window = {
        notBefore: '2026-10-12T08:00:00Z',
        expiresAt: '2026-10-12T09:00:00Z',
      };
    },
  ],
  [
    'dependency on later stage',
    (c) => {
      c.candidates[0]!.prerequisites = [
        { kind: 'after_committed_node', nodeKey: 'alternate_arrangement' },
      ];
    },
  ],
  [
    'resolved prerequisite with self key',
    (c) => {
      c.candidates[1]!.prerequisites = [
        { kind: 'after_resolved_node', nodeKey: 'alternate_arrangement', outcomes: ['skipped'] },
      ];
    },
  ],
  [
    'resolved prerequisite with missing key',
    (c) => {
      c.candidates[1]!.prerequisites = [
        { kind: 'after_resolved_node', nodeKey: 'absent', outcomes: ['skipped'] },
      ];
    },
  ],
  [
    'duplicate outcome in resolved prerequisite',
    (c) => {
      c.candidates[1]!.prerequisites = [
        {
          kind: 'after_resolved_node',
          nodeKey: 'later_opportunity',
          outcomes: ['skipped', 'skipped'],
        },
      ];
    },
  ],
  [
    'empty resolved outcomes',
    (c) => {
      c.candidates[1]!.prerequisites = [
        { kind: 'after_resolved_node', nodeKey: 'later_opportunity', outcomes: [] },
      ];
    },
  ],
  [
    'all possible prerequisite outcomes excluded',
    (c) => {
      c.candidates[1]!.timeline!.excludeIfResolved = [
        { nodeKey: 'later_opportunity', outcomes: ['declined', 'skipped', 'expired'] },
      ];
    },
  ],
  [
    'fallback key absent',
    (c) => {
      c.candidates[0]!.timeline!.alternatives.onSkipped = ['absent'];
    },
  ],
  [
    'fallback to same node',
    (c) => {
      c.candidates[0]!.timeline!.alternatives.onSkipped = ['later_opportunity'];
    },
  ],
  [
    'reverse-stage fallback',
    (c) => {
      c.candidates[1]!.timeline!.alternatives.onSkipped = ['later_opportunity'];
    },
  ],
  [
    'fallback already closed when source expires',
    (c) => {
      c.candidates[1]!.timeline!.stageKey = 'shift_start';
      c.candidates[1]!.timeline!.window = {
        notBefore: '2026-10-12T09:20:00Z',
        expiresAt: '2026-10-12T09:40:00Z',
      };
    },
  ],
];
for (const [name, change] of timelineFailures)
  test('timeline validator rejects ' + name, () => {
    const c = timedFixture();
    change(c);
    mustReject(c);
  });
test('director-selected is not an actual saved node outcome', () => {
  const c = timedFixture();
  const raw = {
    ...c,
    candidates: c.candidates.map((node, i) =>
      i !== 1
        ? node
        : {
            ...node,
            prerequisites: [
              {
                kind: 'after_resolved_node',
                nodeKey: 'later_opportunity',
                outcomes: ['director_selected'],
              },
            ],
          },
    ),
  };
  mustReject(raw);
});
test('old runtime capability list cannot enable staged content or grant a publishing role', () => {
  const c = timedFixture(),
    legacy = inspectPublishedWorldSupport(fixture());
  const status = inspectPublishedWorldSupport(c, new Set(legacy.requiredCapabilities));
  assert.deepEqual(status.missingCapabilities, ['publication.timeline.v1']);
  assert.equal(status.runtimeReady, false);
  assert.equal(status.grantsPublicationAuthority, false);
});
test('story window uses the supplied clock and half-open endpoints, without changing content or evaluating phase eligibility', () => {
  const c = timedFixture(),
    before = structuredClone(c),
    window = c.candidates[0]!.timeline!.window!;
  assert.equal(publicationStoryWindowState(window, '2026-10-12T09:14:59Z'), 'not_open');
  assert.equal(publicationStoryWindowState(window, window.notBefore), 'open');
  assert.equal(publicationStoryWindowState(window, '2026-10-12T09:44:59Z'), 'open');
  assert.equal(publicationStoryWindowState(window, window.expiresAt), 'expired');
  assert.deepEqual(c, before);
  assert.ok(!('eligibleNodes' in previewPublishedWorldContent(c)));
});
// Impossible not_before conditions are not editorial timeNote: they are structured prerequisites.
test('structured not_before at node deadline leaves no possible instant and must reject', () => {
  const c = timedFixture();
  c.candidates[0]!.prerequisites = [{ kind: 'not_before', at: '2026-10-12T09:45:00Z' }];
  mustReject(c);
});
test('structured not_before after inherited stage deadline cannot be stored as a satisfiable candidate', () => {
  const c = timedFixture();
  delete c.candidates[0]!.timeline!.window;
  c.candidates[0]!.prerequisites = [{ kind: 'not_before', at: '2026-10-12T10:30:00Z' }];
  mustReject(c);
});
test('window helper rejects an impossible real-calendar clock date instead of normalizing it to March', () => {
  assert.throws(() =>
    publicationStoryWindowState(
      { notBefore: '2026-03-01T00:00:00Z', expiresAt: '2026-03-05T00:00:00Z' },
      '2026-02-30T09:00:00Z',
    ),
  );
});
test('window helper rejects an impossible real-calendar boundary date, even outside the raw schema wrapper', () => {
  assert.throws(() =>
    publicationStoryWindowState(
      { notBefore: '2026-02-30T00:00:00Z', expiresAt: '2026-03-05T00:00:00Z' },
      '2026-03-03T09:00:00Z',
    ),
  );
});
