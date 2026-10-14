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
  PUBLICATION_LIFE_MODULE_MAX_CHARS,
  type PublicationContent,
} from '../src/modules/settings/domain/publication-content.ts';
import { AuthoredLifeModulesSchema } from '../src/contracts/authored-social.ts';
import { ensurePublishableDefaults } from '../src/modules/settings/domain/publication-defaults.ts';

test('authored history may contain a privately referenced image or video without embedded file bytes', () => {
  const draft = content();
  const assetId = '7317f3cc-c3fd-46ed-a9f6-41c7449de671';
  draft.phone.messages[0] = {
    ...draft.phone.messages[0]!,
    text: '',
    attachment: { kind: 'video', assetId, label: '开业前的录像' },
  };
  const parsed = PublishedWorldContentSchema.parse(draft);
  assert.deepEqual(parsed.phone.messages[0]!.attachment, { kind: 'video', assetId, label: '开业前的录像' });
  assert.deepEqual(publicationPlayerPreview(parsed).phone.messages[0]!.attachment, parsed.phone.messages[0]!.attachment);
  assert.deepEqual((ensurePublishableDefaults(draft) as PublicationContent).phone.messages[0]!.attachment, parsed.phone.messages[0]!.attachment);
  const missing = structuredClone(draft);
  delete missing.phone.messages[0]!.attachment;
  assert.equal(PublishedWorldContentSchema.safeParse(missing).success, false);
  const injected = structuredClone(draft);
  injected.phone.messages[0]!.attachment = { kind: 'video', assetId: 'not-an-id' };
  assert.equal(PublishedWorldContentSchema.safeParse(injected).success, false);
});

function content(): PublicationContent {
  return {
    schemaVersion: 1,
    work: {
      key: 'small_shop',
      title: '河边的小店',
      hook: '和朋友一起整理开业计划',
      description: '非露骨原创虚构样例',
      experienceNote: '先回应邀约，再决定是否参与',
      coverMediaKey: 'cover',
    },
    world: {
      publicSetting: '玩家来到河边的小店。',
      tone: '平和',
      startAt: '2026-10-12T09:00:00Z',
      startPlaceKey: 'shop',
      hiddenContext: '隐藏世界标记',
    },
    protagonist: {
      identity: '小店的合伙人',
      situation: '正在商量开业安排',
      knownFactKeys: ['old_meeting'],
    },
    actors: [
      {
        key: 'ning_one',
        name: '阿宁',
        knownAtStart: true,
        publicCard: {
          identity: '一起筹备小店的伙伴',
          traits: ['耐心'],
          avatarMediaKey: 'portrait',
        },
        privatePersona: {
          background: '隐藏人格甲',
          motivation: '隐藏愿望甲',
          voice: '慢慢说',
          boundaries: '隐藏底线甲',
        },
      },
      {
        key: 'ning_two',
        name: '阿宁',
        knownAtStart: true,
        publicCard: { traits: [] },
        privatePersona: {
          background: '隐藏人格乙',
          motivation: '隐藏愿望乙',
          voice: '说话简短',
          boundaries: '隐藏底线乙',
        },
      },
    ],
    relationships: [
      {
        key: 'partner',
        from: { kind: 'player' },
        to: { kind: 'actor', actorKey: 'ning_one' },
        description: '共同筹备小店',
        visibility: { kind: 'player' },
      },
    ],
    places: [
      {
        key: 'shop',
        name: '河边小店',
        description: '一间明亮的小店',
        knownAtStart: true,
        sceneMediaKey: 'shop_image',
      },
      { key: 'courtyard', name: '小院', description: '店后的小院', knownAtStart: true },
    ],
    routes: [{ fromPlaceKey: 'shop', toPlaceKey: 'courtyard', minutes: 5 }],
    history: [
      {
        key: 'old_meeting',
        kind: 'established_fact',
        text: '上周讨论过一次开业时间。',
        occurredAt: '2026-10-05T09:00:00Z',
        actorKeys: ['ning_one'],
        placeKey: 'shop',
        visibility: { kind: 'world' },
      },
      {
        key: 'private_note',
        kind: 'established_fact',
        text: '隐藏旧事标记',
        occurredAt: '2026-10-06T09:00:00Z',
        actorKeys: ['ning_two'],
        visibility: { kind: 'actors', actorKeys: ['ning_two'] },
      },
    ],
    initialKnowledge: [
      { actorKey: 'ning_one', factKeys: ['old_meeting'] },
      { actorKey: 'ning_two', factKeys: ['private_note'] },
    ],
    phone: {
      messages: [
        {
          key: 'old_letter',
          actorKey: 'ning_one',
          origin: 'history',
          text: '上周先讨论一下开业安排。',
          at: '2026-10-05T09:00:00Z',
        },
        {
          key: 'hello',
          actorKey: 'ning_one',
          origin: 'incoming',
          text: '要不要下午一起看看小院？',
          at: '2026-10-12T08:59:00Z',
        },
      ],
      notes: [
        { key: 'note', title: '已知安排', text: '先讨论再决定。', factKeys: ['old_meeting'] },
      ],
      invitations: [
        {
          key: 'invite',
          actorKeys: ['ning_one'],
          placeKey: 'courtyard',
          messageKey: 'hello',
          title: '看看小院',
          at: '2026-10-12T11:00:00Z',
          status: 'proposed',
        },
      ],
      album: [
        {
          key: 'old_picture',
          mediaKey: 'album_photo',
          title: '上周讨论地点',
          historyFactKey: 'old_meeting',
        },
      ],
    },
    media: [
      {
        key: 'cover',
        asset: { namespace: 'publication', key: 'cover_asset', revision: 1 },
        use: 'cover',
        depiction: 'illustration',
        label: '原创意境插画',
        visibility: { kind: 'world' },
      },
      {
        key: 'portrait',
        asset: { namespace: 'publication', key: 'portrait_asset', revision: 2 },
        use: 'avatar',
        depiction: 'uploaded_image',
        label: '授权形象图片',
        visibility: { kind: 'player' },
      },
      {
        key: 'shop_image',
        asset: { namespace: 'publication', key: 'shop_asset', revision: 1 },
        use: 'scene',
        depiction: 'illustration',
        label: '原创场景插画',
        visibility: { kind: 'world' },
      },
      {
        key: 'album_photo',
        asset: { namespace: 'publication', key: 'album_asset', revision: 1 },
        use: 'album',
        depiction: 'uploaded_image',
        label: '已选剧情图片',
        visibility: { kind: 'player' },
      },
    ],
    candidates: [
      {
        key: 'look_courtyard',
        kind: 'candidate',
        title: '可考虑的小院见面',
        editorialIntent: '未来候选标记，导演可以不选择，也不能写玩家已经到达。',
        actorKeys: ['ning_one'],
        placeKey: 'courtyard',
        prerequisites: [
          { kind: 'history_fact', factKey: 'old_meeting' },
          { kind: 'at_place', placeKey: 'shop' },
        ],
        mutuallyExclusiveNodeKeys: [],
        intent: {
          kind: 'offer_invitation',
          actorKeys: ['ning_one'],
          placeKey: 'courtyard',
          title: '提出看看小院的邀请',
          earliestAt: '2026-10-12T11:00:00Z',
        },
      },
    ],
    extensions: [
      {
        namespace: 'author.notes',
        version: 1,
        purpose: 'editorial',
        description: '仅供内部核对',
        data: { extra: '扩展私有标记', nested: ['one', 2, true, null] },
      },
    ],
  };
}

test('library event preserves long manuscript and several scenes without preassigning a speaker', () => {
  const c = content();
  const node = c.candidates[0]!;
  node.intent = { kind: 'director_event' };
  node.direction = { mode: 'optional' };
  node.script = '作者原文与可能发生的前提。'.repeat(400);
  node.editorialIntent = node.script;
  node.sceneText = '手机聊天界面与多个既有地点';
  node.scenePlaceKeys = c.places.map((place) => place.key);
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
  assert.equal(publicationContentIssues(c).length, 0);
  assert.doesNotMatch(JSON.stringify(publicationPlayerPreview(c)), /作者原文与可能发生的前提|scenePlaceKeys/);
  node.scenePlaceKeys.push('missing');
  assert.ok(publicationContentIssues(c).some((issue) => issue.code === 'unknown_place'));
});

test('author-confirmed event pacing and observable conversation outcomes stay private', () => {
  const c = content();
  c.candidates[0]!.direction = {
    mode: 'optional',
    expectedImpact: '见面后可能改变彼此看法；这不是已发生事实。',
    progress: {
      pace: 'brief',
      refusal: 'defer',
      completion: {
        mode: 'any',
        criteria: [
          { key: 'reply', kind: 'invitation_response', response: 'declined' },
          { key: 'line', kind: 'npc_exact_message', actorKey: 'ning_one', phrase: '先缓一缓' },
        ],
      },
    },
  };
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
  assert.equal(publicationContentIssues(c).length, 0);
  assert.doesNotMatch(
    JSON.stringify(publicationPlayerPreview(c)),
    /先缓一缓|expectedImpact|progress/,
  );

  const invalid = structuredClone(c);
  invalid.candidates[0]!.direction!.progress!.completion!.criteria[1] = {
    key: 'line',
    kind: 'npc_exact_message',
    actorKey: 'ning_two',
    phrase: '先缓一缓',
  };
  assert.ok(
    publicationContentIssues(invalid).some((issue) => issue.code === 'progress_actor_outside_node'),
  );
  invalid.candidates[0]!.direction!.progress!.completion!.criteria[1] = {
    key: 'reply',
    kind: 'invitation_response',
    response: 'accepted',
  };
  assert.ok(publicationContentIssues(invalid).some((issue) => issue.code === 'duplicate_key'));
  invalid.candidates[0]!.intent = { kind: 'editorial_only' };
  assert.ok(
    publicationContentIssues(invalid).some(
      (issue) => issue.code === 'progress_requires_director_or_invitation',
    ),
  );
});
function rejected(change: (c: PublicationContent) => void, code?: string) {
  const c = content();
  change(c);
  const result = PublishedWorldContentSchema.safeParse(c);
  assert.equal(result.success, false);
  if (code && !result.success)
    assert.ok(
      result.error.issues.some((i) => i.message === code),
      JSON.stringify(result.error.issues.map((i) => ({ path: i.path, message: i.message }))),
    );
}

test('two same-named characters remain distinct by stable key; all valid content and extensions roundtrip without trimming', () => {
  const c = content();
  c.actors[0]!.name = ' 阿宁 ';
  const p = PublishedWorldContentSchema.parse(c);
  assert.deepEqual(p, c);
  assert.equal(p.actors.length, 2);
  assert.equal(p.actors[0]?.name, ' 阿宁 ');
  assert.notEqual(p.actors[0]?.key, p.actors[1]?.key);
  assert.deepEqual(publicationContentIssues(p), []);
});
test('event location is distinct from an arrival requirement and must be reachable on the player map', () => {
  const c = content();
  c.candidates[0]!.settingPlaceKey = 'courtyard';
  assert.deepEqual(publicationContentIssues(c), []);
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
  c.routes = [];
  assert.ok(publicationContentIssues(c).some((issue) => issue.code === 'story_place_unreachable'));
  c.routes = [{ fromPlaceKey: 'shop', toPlaceKey: 'courtyard', minutes: 5 }];
  c.places[1]!.knownAtStart = false;
  c.phone.invitations = [];
  assert.deepEqual(publicationContentIssues(c), []);
  c.routes = [];
  assert.ok(publicationContentIssues(c).some((issue) => issue.code === 'story_place_unreachable'));
  c.candidates[0]!.intent = { kind: 'editorial_only' };
  assert.equal(
    publicationContentIssues(c).some((issue) => issue.code.startsWith('story_place_')),
    false,
  );
});
test('public preview whitelist excludes hidden personas, knowledge, hidden history, future nodes and extensions', () => {
  const c = content(),
    before = structuredClone(c),
    p = previewPublishedWorldContent(c),
    json = JSON.stringify(p);
  assert.equal(p.kind, 'authoring_preview');
  assert.equal(p.actors.length, 2);
  assert.match(json, /一起筹备小店/);
  assert.doesNotMatch(
    json,
    /隐藏|未来候选标记|扩展私有标记|privatePersona|candidates|extensions|initialKnowledge|hiddenContext|private_note/,
  );
  assert.equal(p.phone.invitations[0]?.status, 'proposed');
  assert.deepEqual(c, before);
});
test('unknown actor/place and actor-scoped relationship/scene image stay absent from preview', () => {
  const c = content();
  c.actors.push({
    ...structuredClone(c.actors[1]!),
    key: 'hidden_actor',
    name: '未认识人物',
    knownAtStart: false,
  });
  c.places.push({
    key: 'hidden_place',
    name: '未认识地点',
    description: '未认识场景标记',
    knownAtStart: false,
  });
  c.relationships.push({
    key: 'secret_tie',
    from: { kind: 'actor', actorKey: 'ning_one' },
    to: { kind: 'actor', actorKey: 'ning_two' },
    description: '隐藏关系标记',
    visibility: { kind: 'actors', actorKeys: ['ning_one'] },
  });
  c.routes.push({ fromPlaceKey: 'shop', toPlaceKey: 'hidden_place', minutes: 3 });
  const json = JSON.stringify(previewPublishedWorldContent(c));
  assert.doesNotMatch(json, /未认识|hidden_actor|hidden_place|hidden关系|隐藏关系/);
});
test('returned previews are independent copies including refs, traits and image revisions', () => {
  const c = content(),
    p = previewPublishedWorldContent(c);
  p.actors[0]!.publicCard.traits.push('改变');
  p.phone.invitations[0]!.actorKeys.push('bad');
  p.relationships[0]!.to = { kind: 'player' };
  p.work.cover!.asset.revision = 99;
  assert.equal(c.actors[0]!.publicCard.traits.length, 1);
  assert.deepEqual(c.phone.invitations[0]!.actorKeys, ['ning_one']);
  assert.equal(c.media[0]!.asset.revision, 1);
  assert.equal(c.relationships[0]!.to.kind, 'actor');
});
for (const section of [
  'actors',
  'relationships',
  'places',
  'history',
  'media',
  'candidates',
] as const)
  test(`duplicate stable keys reject in ${section}`, () =>
    rejected((c) => {
      c[section].push(structuredClone(c[section][0]!) as never);
    }, 'duplicate_key'));
for (const section of ['messages', 'notes', 'invitations', 'album'] as const)
  test(`duplicate phone keys reject in ${section}`, () =>
    rejected((c) => {
      c.phone[section].push(structuredClone(c.phone[section][0]!) as never);
    }, 'duplicate_key'));
test('typed local namespaces can share a key without accidentally treating an actor as a place', () => {
  const c = content();
  c.places.push({
    key: 'ning_one',
    name: '地点同键',
    description: '显式地点作用域',
    knownAtStart: true,
  });
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
  rejected((c) => {
    c.world.startPlaceKey = 'ning_one';
  }, 'unknown_place');
});
const referenceFailures: [string, (c: PublicationContent) => void, string][] = [
  [
    'dangling relationship',
    (c) => {
      c.relationships[0]!.to = { kind: 'actor', actorKey: 'missing' };
    },
    'unknown_actor',
  ],
  [
    'self relationship',
    (c) => {
      c.relationships[0]!.to = { kind: 'player' };
    },
    'self_relationship',
  ],
  [
    'dangling start location',
    (c) => {
      c.world.startPlaceKey = 'missing';
    },
    'unknown_place',
  ],
  [
    'start location unknown to player',
    (c) => {
      c.places[0]!.knownAtStart = false;
    },
    'start_place_not_known',
  ],
  [
    'dangling route',
    (c) => {
      c.routes[0]!.toPlaceKey = 'missing';
    },
    'unknown_place',
  ],
  [
    'self route',
    (c) => {
      c.routes[0]!.toPlaceKey = 'shop';
    },
    'self_route',
  ],
  [
    'dangling media',
    (c) => {
      c.actors[0]!.publicCard.avatarMediaKey = 'missing';
    },
    'unknown_media',
  ],
  [
    'wrong image purpose',
    (c) => {
      c.actors[0]!.publicCard.avatarMediaKey = 'cover';
    },
    'wrong_media_use',
  ],
  [
    'secret image on public card',
    (c) => {
      c.media[1]!.visibility = { kind: 'actors', actorKeys: ['ning_one'] };
    },
    'media_not_player_visible',
  ],
  [
    'dangling history actor',
    (c) => {
      c.history[0]!.actorKeys = ['missing'];
    },
    'unknown_actor',
  ],
  [
    'dangling history place',
    (c) => {
      c.history[0]!.placeKey = 'missing';
    },
    'unknown_place',
  ],
  [
    'visibility actor missing',
    (c) => {
      c.history[1]!.visibility = { kind: 'actors', actorKeys: ['missing'] };
    },
    'unknown_actor',
  ],
  [
    'player knows secret actor fact',
    (c) => {
      c.protagonist.knownFactKeys.push('private_note');
    },
    'fact_not_player_visible',
  ],
  [
    'actor knows another private fact',
    (c) => {
      c.initialKnowledge[0]!.factKeys.push('private_note');
    },
    'fact_not_actor_visible',
  ],
  [
    'dangling knowledge',
    (c) => {
      c.initialKnowledge[0]!.factKeys.push('missing');
    },
    'unknown_fact',
  ],
  [
    'unknown initial sender',
    (c) => {
      c.phone.messages[0]!.actorKey = 'missing';
    },
    'unknown_actor',
  ],
  [
    'hidden sender in initial phone',
    (c) => {
      c.actors[0]!.knownAtStart = false;
    },
    'sender_not_player_known',
  ],
  [
    'dangling invitation source',
    (c) => {
      c.phone.invitations[0]!.messageKey = 'missing';
    },
    'unknown_message',
  ],
  [
    'invitation sender mismatch',
    (c) => {
      c.phone.invitations[0]!.actorKeys = ['ning_two'];
    },
    'invitation_sender_mismatch',
  ],
  [
    'note knows hidden history',
    (c) => {
      c.phone.notes[0]!.factKeys = ['private_note'];
    },
    'fact_not_player_visible',
  ],
  [
    'album without known historical basis',
    (c) => {
      c.phone.album[0]!.historyFactKey = 'private_note';
    },
    'fact_not_player_known',
  ],
  [
    'dangling candidate',
    (c) => {
      c.candidates[0]!.prerequisites.push({ kind: 'after_committed_node', nodeKey: 'missing' });
    },
    'invalid_node_reference',
  ],
  [
    'self candidate prerequisite',
    (c) => {
      c.candidates[0]!.prerequisites.push({
        kind: 'after_committed_node',
        nodeKey: 'look_courtyard',
      });
    },
    'invalid_node_reference',
  ],
  [
    'dangling exclusivity',
    (c) => {
      c.candidates[0]!.mutuallyExclusiveNodeKeys = ['missing'];
    },
    'invalid_node_reference',
  ],
  [
    'candidate has wrong actor scope',
    (c) => {
      c.candidates[0]!.intent = {
        kind: 'offer_message',
        actorKey: 'ning_two',
        text: '可考虑的邀请',
      };
    },
    'intent_actor_outside_node',
  ],
  [
    'candidate has wrong place scope',
    (c) => {
      c.candidates[0]!.intent = {
        kind: 'offer_invitation',
        actorKeys: ['ning_one'],
        placeKey: 'shop',
        title: '邀请',
        earliestAt: c.world.startAt,
      };
    },
    'intent_place_outside_node',
  ],
];
for (const [name, change, code] of referenceFailures) test(name, () => rejected(change, code));
test('candidate after committed dependencies cannot contain an impossible cycle', () =>
  rejected((c) => {
    const a = c.candidates[0]!;
    a.prerequisites = [{ kind: 'after_committed_node', nodeKey: 'other' }];
    c.candidates.push({
      ...structuredClone(a),
      key: 'other',
      prerequisites: [{ kind: 'after_committed_node', nodeKey: a.key }],
    });
  }, 'candidate_dependency_cycle'));
for (const [name, change, code] of [
  [
    'future fact',
    (c: PublicationContent) => {
      c.history[0]!.occurredAt = '2026-10-13T00:00:00Z';
    },
    'future_in_history',
  ],
  [
    'future initial message',
    (c: PublicationContent) => {
      c.phone.messages[0]!.at = '2026-10-13T00:00:00Z';
    },
    'future_opening_message',
  ],
  [
    'past invitation',
    (c: PublicationContent) => {
      c.phone.invitations[0]!.at = '2026-10-01T00:00:00Z';
    },
    'invitation_before_start',
  ],
  [
    'candidate past time',
    (c: PublicationContent) => {
      c.candidates[0]!.prerequisites = [{ kind: 'not_before', at: '2026-10-01T00:00:00Z' }];
    },
    'candidate_time_before_start',
  ],
] as const)
  test(name, () => rejected(change, code));
test('candidate/promised/completed fields cannot be smuggled into history, initial invitations or node intent', () => {
  for (const raw of [
    { ...content(), history: [{ ...content().history[0], kind: 'candidate' }] },
    { ...content(), history: [{ ...content().history[0], playerCompleted: true }] },
    {
      ...content(),
      phone: {
        ...content().phone,
        invitations: [{ ...content().phone.invitations[0], status: 'confirmed' }],
      },
    },
    {
      ...content(),
      candidates: [
        { ...content().candidates[0], intent: { kind: 'player_completed', actorKey: 'ning_one' } },
      ],
    },
  ])
    assert.equal(PublishedWorldContentSchema.safeParse(raw).success, false);
});
test('cross-work namespaced refs and private owner URL/assets are not accepted publication references', () => {
  rejected((c) => {
    c.actors[0]!.key = 'other_world/ning_one';
  });
  const c = content();
  assert.equal(
    PublishedWorldContentSchema.safeParse({
      ...c,
      media: [
        {
          ...c.media[0],
          asset: { namespace: 'owner', key: 'private', revision: 1, url: '/api/v1/assets/private' },
        },
      ],
    }).success,
    false,
  );
});
test('unknown schema and unknown top-level or nested fields reject instead of being stripped', () => {
  const c = content();
  for (const raw of [
    { ...c, schemaVersion: 2 },
    { ...c, rawOriginal: '私有原稿' },
    { ...c, actors: [{ ...c.actors[0], extra: '未声明字段' }, c.actors[1]] },
  ])
    assert.equal(PublishedWorldContentSchema.safeParse(raw).success, false);
});
test('extension JSON remains exactly stored but never becomes runtime support or appears in safe preview', () => {
  const c = content();
  c.extensions.push({
    namespace: 'tools.money_transfer',
    version: 5,
    purpose: 'runtime_required',
    description: '尚未支持的资金功能',
    data: { amount: 5, unknownFlag: true },
  });
  const parsed = PublishedWorldContentSchema.parse(c),
    support = inspectPublishedWorldSupport(
      parsed,
      new Set([
        'publication.opening.v1',
        'publication.media.v1',
        'candidate.offer_invitation.v1',
        'tools.money_transfer',
      ]),
    );
  assert.deepEqual(parsed.extensions, c.extensions);
  assert.deepEqual(support.unsupportedRuntimeExtensions, ['tools.money_transfer']);
  assert.equal(support.runtimeReady, false);
  assert.equal(support.grantsPublicationAuthority, false);
  assert.doesNotMatch(
    JSON.stringify(previewPublishedWorldContent(parsed)),
    /money_transfer|unknownFlag|amount/,
  );
});
test('no supplied capability registry means new opening/media/intent explicitly unsupported, not publishable', () => {
  const c = content(),
    r = inspectPublishedWorldSupport(c);
  assert.equal(r.runtimeReady, false);
  assert.deepEqual(r.missingCapabilities, [
    'publication.opening.v1',
    'publication.media.v1',
    'candidate.offer_invitation.v1',
  ]);
  assert.equal(r.grantsPublicationAuthority, false);
  const configured = publicationSupport(c, new Set(r.requiredCapabilities));
  assert.equal(configured.runtimeReady, true);
  assert.equal(configured.grantsPublicationAuthority, false);
});
test('editorial-only node needs no execution capability and still never records a player action', () => {
  const c = content();
  c.candidates[0]!.intent = { kind: 'editorial_only' };
  const r = inspectPublishedWorldSupport(c);
  assert.deepEqual(r.requiredCapabilities, ['publication.opening.v1', 'publication.media.v1']);
  assert.doesNotMatch(
    JSON.stringify(previewPublishedWorldContent(c)),
    /look_courtyard|completed|playerAction/,
  );
});
test('shape-parsed public entry point rejects invalid refs instead of generating partial public data', () => {
  const c = content();
  c.work.coverMediaKey = 'missing';
  assert.throws(() => previewPublishedWorldContent(c));
  assert.throws(() => publicationPlayerPreview(c), /INVALID_PUBLICATION_REFERENCES/);
});
test('storage budget measures UTF-8 bytes; extension and total budgets reject', () => {
  rejected((c) => {
    c.extensions[0]!.data = '汉'.repeat(3000);
  }, 'extension_budget');
  rejected((c) => {
    c.extensions = Array.from({ length: 3 }, (_, i) => ({
      namespace: `author.extra_${i}`,
      version: 1,
      purpose: 'editorial',
      description: '大扩展',
      data: 'x'.repeat(7000),
    }));
  }, 'extensions_budget');
  const c = content();
  c.actors = Array.from({ length: 6 }, (_, i) => ({
    ...structuredClone(c.actors[0]!),
    key: i === 0 ? 'ning_one' : i === 1 ? 'ning_two' : `person_${i}`,
    name: `人物${i}`,
    lifeModules: {
      lifeContext: '界'.repeat(4000),
      traits: '界'.repeat(4000),
      drives: '界'.repeat(4000),
      behavior: '界'.repeat(4000),
      relationships: '界'.repeat(4000),
    },
  }));
  assert.ok(new TextEncoder().encode(JSON.stringify(c)).length > 65536);
  assert.equal(publicationStorageIssues(c).length, 0);
  const parsed = PublishedWorldContentSchema.safeParse(c);
  assert.equal(parsed.success, true, parsed.success ? '' : JSON.stringify(parsed.error.issues));
  assert.ok(
    publicationStorageIssues({ text: '界'.repeat(350000) }).some(
      (e) => e.code === 'content_budget',
    ),
  );
});
test('long authored character prose survives validation and defaults without leaking into the player preview', () => {
  const c = content();
  const prose = '成长经历。'.repeat(1500);
  assert.ok(prose.length > 4000 && prose.length < PUBLICATION_LIFE_MODULE_MAX_CHARS);
  c.actors[0]!.lifeModules = { lifeContext: prose, relationships: prose };
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
  assert.equal(AuthoredLifeModulesSchema.safeParse(c.actors[0]!.lifeModules).success, true);
  const defaults = ensurePublishableDefaults(c as unknown as Record<string, unknown>);
  const modules = (defaults.actors as { lifeModules: { lifeContext: string } }[])[0]!.lifeModules;
  assert.equal(modules.lifeContext, prose);
  assert.doesNotMatch(JSON.stringify(previewPublishedWorldContent(c)), /成长经历/);
  c.actors[0]!.lifeModules!.lifeContext = '界'.repeat(PUBLICATION_LIFE_MODULE_MAX_CHARS + 1);
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, false);
  assert.equal(AuthoredLifeModulesSchema.safeParse(c.actors[0]!.lifeModules).success, false);
  const oversized = ensurePublishableDefaults(c as unknown as Record<string, unknown>);
  assert.equal(
    (oversized.actors as { lifeModules: { lifeContext: string } }[])[0]!.lifeModules.lifeContext,
    c.actors[0]!.lifeModules!.lifeContext,
  );
});

test('plain JSON extensions reject prototype keys, cycles, infinite values, functions and excessive depth before parsing', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  let deep: unknown = 'leaf';
  for (let i = 0; i < 20; i++) deep = { nested: deep };
  for (const raw of [
    cyclic,
    deep,
    JSON.parse('{"__proto__":{"bad":true}}'),
    { v: Infinity },
    { v: () => {} },
    { v: new Date() },
  ]) {
    assert.ok(publicationStorageIssues(raw).length > 0);
    const c = content();
    (c.extensions[0] as unknown as { data: unknown }).data = raw;
    assert.equal(PublishedWorldContentSchema.safeParse(c).success, false);
  }
});
test('count/field limits and empty texts reject, rather than truncating content', () => {
  rejected((c) => {
    c.actors = [c.actors[0]!];
  });
  rejected((c) => {
    c.work.title = 'x'.repeat(81);
  });
  rejected((c) => {
    c.actors[0]!.publicCard.traits = Array(4).fill('外在特质');
  });
  rejected((c) => {
    c.work.hook = '   ';
  });
  rejected((c) => {
    c.candidates = Array.from({ length: 33 }, (_, i) => ({
      ...structuredClone(c.candidates[0]!),
      key: `node_${i}`,
    }));
  });
});

test('JSON guard refuses getters without executing them, and bounds value counts', () => {
  let calls = 0;
  const raw = Object.defineProperty({}, 'danger', {
    enumerable: true,
    get() {
      calls++;
      throw Error('not data');
    },
  });
  assert.ok(publicationStorageIssues(raw).some((i) => i.code === 'invalid_json'));
  assert.equal(calls, 0);
  const c = content();
  (c.extensions[0] as unknown as { data: unknown }).data = raw;
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, false);
  assert.equal(calls, 0);
  assert.ok(
    publicationStorageIssues(Array.from({ length: 12001 }, () => null)).some(
      (i) => i.code === 'storage_values',
    ),
  );
});
test('positive committed-node prerequisite is stored only as a condition, never as completed history', () => {
  const c = content();
  c.candidates.push({
    ...structuredClone(c.candidates[0]!),
    key: 'next_opportunity',
    prerequisites: [{ kind: 'after_committed_node', nodeKey: 'look_courtyard' }],
    intent: { kind: 'editorial_only' },
  });
  const parsed = PublishedWorldContentSchema.parse(c);
  assert.equal(parsed.candidates.length, 2);
  assert.equal(parsed.history.length, 2);
  assert.equal(parsed.phone.invitations[0]?.status, 'proposed');
  assert.doesNotMatch(
    JSON.stringify(previewPublishedWorldContent(parsed)),
    /next_opportunity|after_committed_node|completed/,
  );
});

test('non-JSON hidden fields and sparse/extra-property arrays cannot disappear while saving', () => {
  let calls = 0;
  const hidden = Object.defineProperty({}, 'toJSON', {
    value: () => {
      calls++;
      return 'changed';
    },
  });
  const sparse = Array(2);
  const extra = Object.assign(['plain'], { secret: 'would disappear' });
  for (const value of [hidden, sparse, extra]) {
    assert.ok(publicationStorageIssues(value).length > 0);
    const c = content();
    (c.extensions[0] as unknown as { data: unknown }).data = value;
    assert.equal(PublishedWorldContentSchema.safeParse(c).success, false);
  }
  assert.equal(calls, 0);
});

test('documented minimal two-character example is valid and remains unavailable without a runtime adapter', async () => {
  const { readFile } = await import('node:fs/promises');
  const report = await readFile(
    new URL('../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const block = /```json\n([\s\S]*?)\n```/.exec(report);
  assert.ok(block?.[1]);
  const raw = JSON.parse(block[1]);
  const parsed = PublishedWorldContentSchema.parse(raw);
  assert.equal(parsed.actors.length, 2);
  assert.equal(parsed.actors[0]?.name, parsed.actors[1]?.name);
  assert.notEqual(parsed.actors[0]?.key, parsed.actors[1]?.key);
  assert.deepEqual(parsed.phone.messages, []);
  assert.deepEqual(parsed.history, []);
  const result = inspectPublishedWorldSupport(parsed);
  assert.deepEqual(result.requiredCapabilities, ['publication.opening.v1']);
  assert.deepEqual(result.missingCapabilities, ['publication.opening.v1']);
  assert.equal(result.runtimeReady, false);
  assert.equal(result.grantsPublicationAuthority, false);
});

// Timeline additions preserve every earlier checkpoint test and its fixture unchanged.
function stagedContent(): PublicationContent {
  const c = content();
  c.timeline = {
    initialStageKey: 'opening',
    stages: [
      {
        key: 'opening',
        title: '开业准备',
        order: 0,
        afterStageKeys: [],
        window: { notBefore: '2026-10-12T09:00:00Z', expiresAt: '2026-10-12T11:00:00Z' },
      },
      {
        key: 'followup',
        title: '之后的安排',
        order: 1,
        afterStageKeys: ['opening'],
        window: { notBefore: '2026-10-12T10:00:00Z', expiresAt: '2026-10-12T15:00:00Z' },
      },
    ],
  };
  c.candidates[0]!.timeline = {
    stageKey: 'opening',
    window: { notBefore: '2026-10-12T09:00:00Z', expiresAt: '2026-10-12T10:30:00Z' },
    excludeIfResolved: [],
    alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
    timeNote: '只在开业准备阶段提出，可不选择。',
  };
  c.candidates.push({
    ...structuredClone(c.candidates[0]!),
    key: 'talk_later',
    title: '可选择的之后讨论',
    intent: { kind: 'editorial_only' },
    prerequisites: [
      {
        kind: 'after_resolved_node',
        nodeKey: 'look_courtyard',
        outcomes: ['declined', 'skipped', 'expired'],
      },
    ],
    timeline: {
      stageKey: 'followup',
      excludeIfResolved: [],
      alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
    },
  });
  c.candidates[0]!.timeline!.alternatives = {
    onDeclined: ['talk_later'],
    onSkipped: ['talk_later'],
    onExpired: ['talk_later'],
  };
  return c;
}
function timelineRejected(change: (c: PublicationContent) => void, code?: string) {
  const c = stagedContent();
  change(c);
  const parsed = PublishedWorldContentSchema.safeParse(c);
  assert.equal(parsed.success, false);
  if (code && !parsed.success)
    assert.ok(
      parsed.error.issues.some((e) => e.message === code),
      JSON.stringify(parsed.error.issues.map((e) => ({ path: e.path, message: e.message }))),
    );
}
test('stage order, story windows and optional decline/skip paths store without marking any node occurred', () => {
  const c = stagedContent(),
    before = structuredClone(c),
    parsed = PublishedWorldContentSchema.parse(c);
  assert.deepEqual(parsed, c);
  assert.equal(parsed.history.length, before.history.length);
  assert.equal(parsed.candidates[0]!.kind, 'candidate');
  const preview = JSON.stringify(previewPublishedWorldContent(parsed));
  assert.doesNotMatch(
    preview,
    /timeline|opening.*order|talk_later|onSkipped|after_resolved_node|开业准备阶段/,
  );
  assert.deepEqual(c, before);
});
test('parallel independent nodes in the same stage need not be forced into one linear sequence', () => {
  const c = stagedContent();
  c.candidates.push({
    ...structuredClone(c.candidates[0]!),
    key: 'independent',
    prerequisites: [],
    timeline: {
      stageKey: 'opening',
      excludeIfResolved: [],
      alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
    },
  });
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
  assert.equal(c.candidates.find((n) => n.key === 'independent')!.prerequisites.length, 0);
});
test('parallel stages can share an order without declaring a false dependency', () => {
  const c = stagedContent();
  c.timeline!.stages.push({
    key: 'parallel',
    title: '并行安排',
    order: 1,
    afterStageKeys: ['opening'],
  });
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
});
const invalidTimeline: [string, (c: PublicationContent) => void, string][] = [
  [
    'unknown initial stage',
    (c) => {
      c.timeline!.initialStageKey = 'missing';
    },
    'unknown_stage',
  ],
  [
    'duplicate stage key',
    (c) => {
      c.timeline!.stages.push(structuredClone(c.timeline!.stages[0]!));
    },
    'duplicate_key',
  ],
  [
    'unknown predecessor stage',
    (c) => {
      c.timeline!.stages[1]!.afterStageKeys = ['missing'];
    },
    'unknown_stage',
  ],
  [
    'reverse stage dependency',
    (c) => {
      c.timeline!.stages[0]!.afterStageKeys = ['followup'];
    },
    'reverse_stage_dependency',
  ],
  [
    'same-order predecessor is not a parallel independent stage',
    (c) => {
      c.timeline!.stages[1]!.order = 0;
    },
    'reverse_stage_dependency',
  ],
  [
    'stage cycle',
    (c) => {
      c.timeline!.stages[0]!.afterStageKeys = ['followup'];
    },
    'stage_dependency_cycle',
  ],
  [
    'unknown candidate stage',
    (c) => {
      c.candidates[0]!.timeline!.stageKey = 'missing';
    },
    'unknown_stage',
  ],
  [
    'stage-less candidate in a staged work',
    (c) => {
      delete c.candidates[0]!.timeline;
    },
    'candidate_stage_missing',
  ],
  [
    'candidate timeline without declared work timeline',
    (c) => {
      delete c.timeline;
    },
    'timeline_missing',
  ],
  [
    'equal story window endpoints',
    (c) => {
      c.candidates[0]!.timeline!.window!.expiresAt = c.candidates[0]!.timeline!.window!.notBefore;
    },
    'invalid_story_window',
  ],
  [
    'reverse stage window',
    (c) => {
      c.timeline!.stages[0]!.window!.expiresAt = '2026-10-12T08:00:00Z';
    },
    'invalid_story_window',
  ],
  [
    'initial phase not open at start',
    (c) => {
      c.timeline!.stages[0]!.window!.notBefore = '2026-10-12T09:30:00Z';
    },
    'start_outside_stage_window',
  ],
  [
    'candidate window outside stage',
    (c) => {
      c.candidates[0]!.timeline!.window!.expiresAt = '2026-10-12T12:00:00Z';
    },
    'node_window_outside_stage',
  ],
  [
    'expired candidate cannot be current at world start',
    (c) => {
      c.candidates[0]!.timeline!.window = {
        notBefore: '2026-10-12T07:00:00Z',
        expiresAt: c.world.startAt,
      };
    },
    'candidate_expired_at_start',
  ],
  [
    'earlier stage depends on future node',
    (c) => {
      c.candidates[0]!.prerequisites = [{ kind: 'after_committed_node', nodeKey: 'talk_later' }];
    },
    'reverse_node_stage_dependency',
  ],
  [
    'late fallback points back to prior stage',
    (c) => {
      c.candidates[1]!.timeline!.alternatives.onSkipped = ['look_courtyard'];
    },
    'reverse_alternative_stage',
  ],
  [
    'unknown fallback node',
    (c) => {
      c.candidates[0]!.timeline!.alternatives.onDeclined = ['missing'];
    },
    'invalid_node_reference',
  ],
  [
    'self fallback node',
    (c) => {
      c.candidates[0]!.timeline!.alternatives.onSkipped = ['look_courtyard'];
    },
    'invalid_node_reference',
  ],
  [
    'unknown exclusion',
    (c) => {
      c.candidates[1]!.timeline!.excludeIfResolved = [
        { nodeKey: 'missing', outcomes: ['committed'] },
      ];
    },
    'invalid_node_reference',
  ],
  [
    'same required and excluded actual result',
    (c) => {
      c.candidates[1]!.timeline!.excludeIfResolved = [
        { nodeKey: 'look_courtyard', outcomes: ['declined', 'skipped', 'expired'] },
      ];
    },
    'contradictory_node_condition',
  ],
  [
    'progression cycle in alternatives',
    (c) => {
      c.candidates[1]!.timeline!.stageKey = 'opening';
      c.candidates[1]!.timeline!.alternatives.onSkipped = ['look_courtyard'];
    },
    'candidate_progression_cycle',
  ],
];
for (const [name, change, code] of invalidTimeline)
  test(name, () => timelineRejected(change, code));
test('declined or skipped prerequisites cannot be forged with director_selected or empty outcomes', () => {
  for (const outcomes of [[], ['director_selected'], ['completed_without_event']]) {
    const c = stagedContent();
    (c.candidates[1]!.prerequisites[0] as unknown as { outcomes: string[] }).outcomes = outcomes;
    assert.equal(PublishedWorldContentSchema.safeParse(c).success, false);
  }
});
test('an excluded committed result still permits an actual skipped or declined alternate path', () => {
  const c = stagedContent();
  c.candidates[1]!.timeline!.excludeIfResolved = [
    { nodeKey: 'look_courtyard', outcomes: ['committed'] },
  ];
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
});
test('timeline capability is additionally required and a legacy adapter list cannot make it runnable', () => {
  const c = stagedContent(),
    legacy = inspectPublishedWorldSupport(content());
  const result = inspectPublishedWorldSupport(c, new Set(legacy.requiredCapabilities));
  assert.deepEqual(result.missingCapabilities, ['publication.timeline.v1']);
  assert.equal(result.runtimeReady, false);
  assert.equal(result.grantsPublicationAuthority, false);
});
test('story-time expiry is half-open and never consults a real wall clock or writes history', async () => {
  const { publicationStoryWindowState } =
    await import('../src/modules/settings/domain/publication-content.ts');
  const c = stagedContent(),
    before = structuredClone(c),
    window = c.candidates[0]!.timeline!.window!;
  assert.equal(publicationStoryWindowState(window, '2026-10-12T08:59:00Z'), 'not_open');
  assert.equal(publicationStoryWindowState(window, window.notBefore), 'open');
  assert.equal(publicationStoryWindowState(window, window.expiresAt), 'expired');
  assert.equal(publicationStoryWindowState(window, '2026-10-12T11:00:00Z'), 'expired');
  assert.throws(() => publicationStoryWindowState(window, 'bad'), /INVALID_STORY_WINDOW/);
  assert.deepEqual(c, before);
  assert.doesNotMatch(
    JSON.stringify(previewPublishedWorldContent(c)),
    /look_courtyard|expired|stageKey|onExpired/,
  );
});
test('node chronology cannot require a prerequisite that only opens after its own deadline', () => {
  timelineRejected((c) => {
    c.timeline!.stages[0]!.window = {
      notBefore: '2026-10-12T09:00:00Z',
      expiresAt: '2026-10-12T15:00:00Z',
    };
    c.candidates[1]!.timeline!.stageKey = 'opening';
    c.candidates[1]!.timeline!.window = {
      notBefore: '2026-10-12T12:00:00Z',
      expiresAt: '2026-10-12T14:00:00Z',
    };
    c.candidates[0]!.prerequisites = [{ kind: 'after_committed_node', nodeKey: 'talk_later' }];
  }, 'node_window_before_dependency');
});
test('an expired fallback cannot re-offer a node whose own deadline has already passed', () => {
  timelineRejected((c) => {
    c.candidates[1]!.timeline!.stageKey = 'opening';
    c.candidates[1]!.timeline!.window = {
      notBefore: '2026-10-12T09:30:00Z',
      expiresAt: '2026-10-12T10:00:00Z',
    };
  }, 'alternative_window_before_trigger');
});
test('bounded stage counts/orders and time-note sizes reject instead of dropping fields', () => {
  timelineRejected((c) => {
    c.timeline!.stages[0]!.order = -1;
  });
  timelineRejected((c) => {
    c.timeline!.stages = Array.from({ length: 17 }, (_, i) => ({
      key: `stage_${i}`,
      title: '阶段',
      order: i,
      afterStageKeys: [],
    }));
    c.timeline!.initialStageKey = 'stage_0';
  });
  timelineRejected((c) => {
    c.candidates[0]!.timeline!.timeNote = '字'.repeat(301);
  });
});

test('a distinct expired-path fallback is a condition on a saved expiry, not a replay of the original invitation', () => {
  const c = stagedContent();
  const later = c.candidates[1]!;
  later.prerequisites = [
    { kind: 'after_resolved_node', nodeKey: 'look_courtyard', outcomes: ['expired'] },
  ];
  const parsed = PublishedWorldContentSchema.parse(c);
  assert.equal(parsed.candidates[0]!.timeline!.alternatives.onExpired[0], later.key);
  assert.equal(parsed.candidates[0]!.kind, 'candidate');
  assert.equal(parsed.history.length, 2);
  assert.equal(inspectPublishedWorldSupport(parsed).runtimeReady, false);
  assert.doesNotMatch(
    JSON.stringify(previewPublishedWorldContent(parsed)),
    /onExpired|look_courtyard|expired/,
  );
});

test('documented timeline increment composes with minimal draft while all actual outcomes remain absent', async () => {
  const { readFile } = await import('node:fs/promises');
  const report = await readFile(
    new URL('../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const blocks = [...report.matchAll(/```json\n([\s\S]*?)\n```/g)];
  assert.equal(blocks.length, 2);
  const raw = { ...JSON.parse(blocks[0]![1]!), ...JSON.parse(blocks[1]![1]!) };
  const parsed = PublishedWorldContentSchema.parse(raw);
  assert.equal(parsed.candidates.length, 2);
  assert.deepEqual(parsed.history, []);
  assert.deepEqual(parsed.phone.messages, []);
  assert.deepEqual(inspectPublishedWorldSupport(parsed).missingCapabilities, [
    'publication.opening.v1',
    'publication.timeline.v1',
  ]);
  assert.doesNotMatch(
    JSON.stringify(previewPublishedWorldContent(parsed)),
    /timeline|later_plan|onExpired/,
  );
});
test('all supported actual outcome alternatives can be expressed without treating selection as an outcome', () => {
  const c = stagedContent();
  c.candidates[1]!.prerequisites = [
    {
      kind: 'after_resolved_node',
      nodeKey: 'look_courtyard',
      outcomes: ['committed', 'declined', 'skipped', 'expired'],
    },
  ];
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
});

// Independent audit reproduction: array prototypes must not supply executable serializers.
for (const kind of ['method', 'getter'] as const)
  test(`custom array prototype ${kind} cannot execute during internal JSON validation`, () => {
    let calls = 0;
    const array = ['plain'];
    const prototype =
      kind === 'method'
        ? {
            toJSON() {
              calls++;
              return { changedByCode: 'SERIALIZER_REPLACEMENT' };
            },
          }
        : Object.defineProperty({}, 'toJSON', {
            get() {
              calls++;
              return () => ({ changedByCode: 'SERIALIZER_REPLACEMENT' });
            },
          });
    Object.setPrototypeOf(array, prototype);
    const c = content();
    c.extensions[0]!.data = array;
    const result = PublishedWorldContentSchema.safeParse(c);
    assert.equal(calls, 0, 'Budget checks must not execute inherited serializers or getters');
    assert.equal(result.success, false, 'Custom array prototypes are not inert JSON');
  });

test('standard and null-prototype arrays remain inert JSON; array subclasses cannot supply code', () => {
  for (const array of [[1, true, null], Object.setPrototypeOf([1, true, null], null)]) {
    const c = content();
    c.extensions[0]!.data = array;
    const parsed = PublishedWorldContentSchema.parse(c);
    assert.deepEqual(JSON.parse(JSON.stringify(parsed.extensions[0]!.data)), [1, true, null]);
  }
  let calls = 0;
  class ExecutableArray extends Array {
    toJSON() {
      calls++;
      return 'replacement';
    }
  }
  const c = content();
  const subclass = new ExecutableArray();
  subclass.push('plain');
  c.extensions[0]!.data = subclass as unknown as PublicationContent['extensions'][number]['data'];
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, false);
  assert.equal(calls, 0);
});

// Preserve every earlier audit/checkpoint while checking satisfiable temporal constraints.
test('a not_before prerequisite at its own deadline has no possible story instant', () => {
  timelineRejected((c) => {
    c.candidates[0]!.prerequisites = [
      { kind: 'not_before', at: c.candidates[0]!.timeline!.window!.expiresAt },
    ];
  }, 'not_before_at_or_after_deadline');
});
test('a not_before prerequisite cannot begin after an inherited stage deadline', () => {
  timelineRejected((c) => {
    delete c.candidates[0]!.timeline!.window;
    c.candidates[0]!.prerequisites = [{ kind: 'not_before', at: '2026-10-12T12:00:00Z' }];
  }, 'not_before_at_or_after_deadline');
});
test('a not_before within a declared or inherited window remains an optional satisfiable condition', () => {
  for (const inherited of [false, true]) {
    const c = stagedContent();
    if (inherited) delete c.candidates[0]!.timeline!.window;
    c.candidates[0]!.prerequisites = [{ kind: 'not_before', at: '2026-10-12T09:30:00Z' }];
    assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
  }
});
test('the standalone story window helper refuses invalid calendar dates for clocks and boundaries', async () => {
  const { publicationStoryWindowState } =
    await import('../src/modules/settings/domain/publication-content.ts');
  const window = { notBefore: '2026-03-01T00:00:00Z', expiresAt: '2026-03-05T00:00:00Z' };
  for (const clock of [
    '2026-02-30T09:00:00Z',
    '2026-02-29T09:00:00Z',
    '2026-03-01T24:00:00Z',
    '2026-13-01T09:00:00Z',
  ])
    assert.throws(() => publicationStoryWindowState(window, clock), /INVALID_STORY_WINDOW/);
  assert.throws(
    () =>
      publicationStoryWindowState(
        { ...window, notBefore: '2026-02-30T00:00:00Z' },
        '2026-03-03T00:00:00Z',
      ),
    /INVALID_STORY_WINDOW/,
  );
  assert.throws(
    () =>
      publicationStoryWindowState(
        { ...window, expiresAt: '2026-02-30T00:00:00Z' },
        '2026-03-03T00:00:00Z',
      ),
    /INVALID_STORY_WINDOW/,
  );
});
test('valid leap days, minute precision and fractional timestamps still use story-time half-open boundaries', async () => {
  const { publicationStoryWindowState } =
    await import('../src/modules/settings/domain/publication-content.ts');
  assert.equal(
    publicationStoryWindowState(
      { notBefore: '2024-02-29T00:00:00Z', expiresAt: '2024-03-01T00:00:00Z' },
      '2024-02-29T12:00:00Z',
    ),
    'open',
  );
  assert.equal(
    publicationStoryWindowState(
      { notBefore: '2026-10-12T09:00Z', expiresAt: '2026-10-12T10:00Z' },
      '2026-10-12T09:30Z',
    ),
    'open',
  );
  assert.equal(
    publicationStoryWindowState(
      { notBefore: '2026-10-12T09:00:00.001Z', expiresAt: '2026-10-12T09:00:00.002Z' },
      '2026-10-12T09:00:00.002Z',
    ),
    'expired',
  );
});

test('opening after a stage with only clock-expiring members is publishable without a stage window', async () => {
  const { evaluateStory } = await import('../src/modules/settings/domain/publication-story.ts');
  const c = content();
  const event = {
    ...structuredClone(c.candidates[0]!),
    intent: { kind: 'director_event' as const, actorKey: c.actors[0]!.key },
    prerequisites: [],
    placeKey: c.world.startPlaceKey,
    mutuallyExclusiveNodeKeys: [],
  };
  c.timeline = {
    initialStageKey: 'before',
    stages: [
      { key: 'before', title: '之前', order: 0, afterStageKeys: [] },
      { key: 'later', title: '开场', order: 1, afterStageKeys: ['before'] },
    ],
  };
  c.candidates = ['prior', 'opening'].map((key, i) => ({
    ...structuredClone(event),
    key,
    timeline: {
      stageKey: i ? 'later' : 'before',
      excludeIfResolved: [],
      alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
      ...(!i ? { window: { notBefore: c.world.startAt, expiresAt: '2026-10-12T09:01:00Z' } } : {}),
    },
  }));
  c.openingEventKey = 'opening';
  const original = structuredClone(c);
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
  assert.deepEqual(c, original);
  const p = {
    schemaVersion: 1 as const,
    origin: { workId: 'test', publicationVersion: 1, draftVersion: 0, contentHash: 'a'.repeat(64) },
    timeline: c.timeline,
    openingEventKey: c.openingEventKey,
    nodes: c.candidates,
    actors: c.actors.map((a) => ({ key: a.key, id: a.key })),
    places: c.places.map((p) => ({ key: p.key, name: p.name })),
    history: [],
  };
  const result = evaluateStory(p, [], {
    storyNow: '2026-10-12T09:02:00Z',
    currentPlaceId: c.world.startPlaceKey,
    availableFactIds: [],
  });
  assert.deepEqual(result.expired, ['prior']);
  assert.deepEqual(result.resolvedStages, ['before']);
  assert.deepEqual(
    result.eligible.map((n) => n.key),
    ['opening'],
  );
  delete c.candidates[0]!.timeline!.window;
  assert.ok(
    publicationContentIssues(c).some((i) => i.code === 'opening_event_requires_prior_stage'),
  );
  c.candidates.shift();
  assert.ok(
    publicationContentIssues(c).some((i) => i.code === 'opening_event_requires_prior_stage'),
  );
});

test('opening ANY branch must be reachable before its effective deadline; ordinary time and known place remain allowed', () => {
  const c = content();
  const event = {
    ...structuredClone(c.candidates[0]!),
    intent: { kind: 'director_event' as const, actorKey: c.actors[0]!.key },
    prerequisites: [],
    placeKey: c.world.startPlaceKey,
    mutuallyExclusiveNodeKeys: [],
  };
  c.timeline = {
    initialStageKey: 'start',
    stages: [
      {
        key: 'start',
        title: '起步',
        order: 0,
        afterStageKeys: [],
        window: { notBefore: c.world.startAt, expiresAt: '2026-10-12T09:03:00Z' },
      },
    ],
  };
  c.candidates = ['prior', 'opening'].map((key) => ({
    ...structuredClone(event),
    key,
    timeline: {
      stageKey: 'start',
      excludeIfResolved: [],
      alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
    },
  }));
  c.candidates[1]!.timeline!.window = {
    notBefore: c.world.startAt,
    expiresAt: '2026-10-12T09:02:00Z',
  };
  c.openingEventKey = 'opening';
  c.conditions = [
    {
      key: 'opening_any',
      title: '开场前提',
      match: 'any',
      prerequisites: [
        { kind: 'after_presented_node', nodeKey: 'prior' },
        { kind: 'not_before', at: '2026-10-12T09:02:00Z' },
      ],
    },
  ];
  c.candidates[1]!.conditionKeys = ['opening_any'];
  const original = structuredClone(c);
  assert.ok(
    publicationContentIssues(c).some((i) => i.code === 'opening_event_requires_prior_event'),
  );
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, false);
  assert.deepEqual(c, original);
  c.conditions[0]!.prerequisites[1] = { kind: 'not_before', at: '2026-10-12T09:01:00Z' };
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
  c.conditions[0]!.prerequisites[1] = { kind: 'at_place', placeKey: c.world.startPlaceKey };
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
  c.conditions[0]!.prerequisites[1] = { kind: 'history_fact', factKey: 'missing' };
  assert.ok(
    publicationContentIssues(c).some((i) => i.code === 'opening_event_requires_prior_event'),
  );
  delete c.timeline.stages[0]!.window;
  delete c.candidates[1]!.timeline!.window;
  c.conditions[0]!.prerequisites[1] = { kind: 'not_before', at: '2026-10-12T12:00:00Z' };
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
});

test('opening history prerequisite requires exact target actor knowledge and allowed visibility', () => {
  const c = content();
  c.openingEventKey = c.candidates[0]!.key;
  c.candidates[0]!.intent = { kind: 'director_event', actorKey: 'ning_one' };
  c.candidates[0]!.prerequisites = [{ kind: 'history_fact', factKey: 'old_meeting' }];
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
  c.initialKnowledge = [];
  assert.ok(
    publicationContentIssues(c).some((i) => i.code === 'opening_event_requires_prior_event'),
  );
  c.initialKnowledge = [{ actorKey: 'ning_two', factKeys: ['old_meeting'] }];
  assert.ok(
    publicationContentIssues(c).some((i) => i.code === 'opening_event_requires_prior_event'),
  );
  c.initialKnowledge = [{ actorKey: 'ning_one', factKeys: ['old_meeting'] }];
  c.history[0]!.visibility = { kind: 'actors', actorKeys: ['ning_two'] };
  assert.ok(
    publicationContentIssues(c).some((i) => i.code === 'opening_event_requires_prior_event'),
  );
  c.history[0]!.visibility = { kind: 'actors', actorKeys: ['ning_one'] };
  assert.ok(
    !publicationContentIssues(c).some((i) => i.code === 'opening_event_requires_prior_event'),
  );
});

test('opening ANY keeps a reachable place or time when its history fact is not initially known to the target', () => {
  const c = content();
  c.openingEventKey = c.candidates[0]!.key;
  c.candidates[0]!.intent = { kind: 'director_event', actorKey: 'ning_one' };
  c.candidates[0]!.prerequisites = [];
  c.initialKnowledge = [];
  c.conditions = [
    {
      key: 'opening_any',
      title: '可达开场',
      match: 'any',
      prerequisites: [
        { kind: 'history_fact', factKey: 'old_meeting' },
        { kind: 'at_place', placeKey: 'shop' },
      ],
    },
  ];
  c.candidates[0]!.conditionKeys = ['opening_any'];
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
  c.conditions[0]!.prerequisites[1] = { kind: 'not_before', at: '2026-10-12T10:00:00Z' };
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
  c.conditions[0]!.match = 'all';
  const original = structuredClone(c);
  assert.ok(
    publicationContentIssues(c).some((i) => i.code === 'opening_event_requires_prior_event'),
  );
  assert.deepEqual(c, original);
});
