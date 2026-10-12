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
  c.world.hiddenContext = '界'.repeat(4000);
  c.actors = Array.from({ length: 12 }, (_, i) => ({
    ...structuredClone(c.actors[0]!),
    key: `person_${i}`,
    privatePersona: {
      background: '界'.repeat(1200),
      motivation: '界'.repeat(600),
      voice: '界'.repeat(600),
      boundaries: '界'.repeat(600),
    },
  }));
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, false);
  assert.ok(publicationStorageIssues(c).some((e) => e.code === 'content_budget'));
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
