import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PublishedWorldContentSchema } from '../src/contracts/published-world-content.ts';
import type { PublicationContent } from '../src/modules/settings/domain/publication-content.ts';
import {
  compilePublicationGenesis,
  PUBLICATION_GENESIS_MAX_BYTES,
} from '../src/modules/settings/infrastructure/publication-genesis.ts';
import type {
  PublicationCompileInput,
  PublicationCompileResult,
} from '../src/modules/settings/application/publication-runtime.ts';
import { actorContext } from '../src/modules/world/application/actor-context.ts';
import { openingMessagesForDisplay } from '../src/modules/world/domain/opening-time.ts';
import { WorldPhoneSchema } from '../src/contracts/world-build.ts';

test('authored media-only history retains its reference through playable genesis', () => {
  const c = content();
  const assetId = '7317f3cc-c3fd-46ed-a9f6-41c7449de671';
  c.phone.messages[0] = {
    ...c.phone.messages[0]!,
    text: '',
    attachment: { kind: 'video', assetId, label: '旧录像' },
  };
  const result = compilePublicationGenesis(input(c));
  assert.equal(result.status, 'compiled');
  if (result.status !== 'compiled') return;
  const message = result.world.messages.find((m) => m.history?.key === 'old_a');
  assert.equal(message?.text, '');
  assert.deepEqual(message?.attachment, { kind: 'video', assetId, label: '旧录像' });
});

test('an unreferenced legacy scene row does not block runtime compilation', () => {
  const c = content();
  c.media.push({
    key: 'unused_old_scene',
    asset: { namespace: 'publication', key: 'old_scene', revision: 1 },
    use: 'scene',
    depiction: 'illustration',
    label: '旧素材',
    visibility: { kind: 'world' },
  });
  const result = compilePublicationGenesis(input(c));
  assert.equal(result.status, 'compiled');
});

function content(): PublicationContent {
  return {
    schemaVersion: 1,
    work: {
      key: 'first_work',
      title: '车站的一个早晨',
      hook: '先商量安排',
      description: '确认后的原创开局',
      experienceNote: '来信是提议，可以拒绝',
    },
    world: {
      publicSetting: '现代城市的车站',
      tone: '日常',
      startAt: '2026-10-12T09:00:00Z',
      startPlaceKey: 'station',
      hiddenContext: 'SECRET_DIRECTOR_SCRIPT_NOT_A_FACT',
    },
    protagonist: { identity: '值班员', situation: '刚开始当班', knownFactKeys: ['common'] },
    actors: [
      {
        key: 'a_first',
        name: '小周',
        knownAtStart: true,
        publicCard: { identity: '同事甲', traits: ['细心'] },
        privatePersona: {
          background: 'PRIVATE_A_BACKGROUND',
          motivation: 'PRIVATE_A_MOTIVE',
          voice: 'PRIVATE_A_VOICE',
          boundaries: 'PRIVATE_A_BOUNDARY',
        },
      },
      {
        key: 'b_second',
        name: '小周',
        knownAtStart: true,
        publicCard: { identity: '同事乙', traits: [] },
        privatePersona: {
          background: 'PRIVATE_B_BACKGROUND',
          motivation: 'PRIVATE_B_MOTIVE',
          voice: 'PRIVATE_B_VOICE',
          boundaries: 'PRIVATE_B_BOUNDARY',
        },
      },
    ],
    relationships: [
      {
        key: 'public_a',
        from: { kind: 'player' },
        to: { kind: 'actor', actorKey: 'a_first' },
        description: '同一班次的同事',
        visibility: { kind: 'player' },
      },
      {
        key: 'private_b',
        from: { kind: 'player' },
        to: { kind: 'actor', actorKey: 'b_second' },
        description: 'PRIVATE_B_RELATION',
        visibility: { kind: 'actors', actorKeys: ['b_second'] },
      },
    ],
    places: [
      { key: 'station', name: '车站', description: '有公共候车区', knownAtStart: true },
      { key: 'yard', name: '小院', description: '旁边的院子', knownAtStart: true },
    ],
    routes: [{ fromPlaceKey: 'station', toPlaceKey: 'yard', minutes: 10 }],
    history: [
      {
        key: 'common',
        kind: 'established_fact',
        text: 'COMMON_WORLD_FACT_ONLY_A_INITIALLY_KNOWS',
        occurredAt: '2026-10-09T09:00:00Z',
        actorKeys: ['a_first', 'b_second'],
        placeKey: 'station',
        visibility: { kind: 'world' },
      },
      {
        key: 'a_secret',
        kind: 'established_fact',
        text: 'PRIVATE_A_HISTORY',
        occurredAt: '2026-10-10T09:00:00Z',
        actorKeys: ['a_first'],
        visibility: { kind: 'actors', actorKeys: ['a_first'] },
      },
      {
        key: 'b_secret',
        kind: 'established_fact',
        text: 'PRIVATE_B_HISTORY',
        occurredAt: '2026-10-11T09:00:00Z',
        actorKeys: ['b_second'],
        visibility: { kind: 'actors', actorKeys: ['b_second'] },
      },
    ],
    initialKnowledge: [
      { actorKey: 'a_first', factKeys: ['common', 'a_secret'] },
      { actorKey: 'b_second', factKeys: ['b_secret'] },
    ],
    phone: {
      messages: [
        {
          key: 'old_a',
          actorKey: 'a_first',
          origin: 'history',
          text: '前天商量过安排',
          at: '2026-10-10T08:00:00Z',
        },
        {
          key: 'old_b',
          actorKey: 'b_second',
          origin: 'history',
          text: '昨天见过面',
          at: '2026-10-11T09:00:00Z',
        },
        {
          key: 'incoming_a',
          actorKey: 'a_first',
          origin: 'incoming',
          text: '今天要一起商量吗？',
          at: '2026-10-12T08:58:00Z',
        },
      ],
      notes: [
        { key: 'known_note', title: '已知安排', text: '先商量，再决定', factKeys: ['common'] },
      ],
      invitations: [
        {
          key: 'invite',
          actorKeys: ['a_first'],
          placeKey: 'yard',
          messageKey: 'incoming_a',
          title: '下午商量',
          at: '2026-10-12T11:00:00Z',
          status: 'proposed',
        },
      ],
      album: [],
    },
    media: [],
    candidates: [],
    extensions: [],
  };
}
function input(c = content(), offset = 0): PublicationCompileInput {
  let counter = 100 + offset;
  return {
    originKind: 'published',
    content: c,
    worldId: `10000000-0000-4000-8000-${String(1 + offset).padStart(12, '0')}`,
    ownerId: `20000000-0000-4000-8000-${String(1 + offset).padStart(12, '0')}`,
    seedId: `30000000-0000-4000-8000-${String(1 + offset).padStart(12, '0')}`,
    origin: {
      workId: '40000000-0000-4000-8000-000000000001',
      publicationVersion: 1,
      draftVersion: 0,
      contentHash: createHash('sha256')
        .update(JSON.stringify(PublishedWorldContentSchema.parse(c)))
        .digest('hex'),
    },
    newId: () => `50000000-0000-4000-8000-${String(counter++).padStart(12, '0')}`,
  };
}
function compiled(
  i: PublicationCompileInput,
): Extract<PublicationCompileResult, { status: 'compiled' }> {
  const result = compilePublicationGenesis(i);
  assert.equal(result.status, 'compiled', JSON.stringify(result));
  assert.ok(result.status === 'compiled');
  return result;
}
function noCompile(i: PublicationCompileInput, expected: 'invalid' | 'unsupported', code?: string) {
  const r = compilePublicationGenesis(i);
  assert.equal(r.status, expected);
  assert.deepEqual(r.capabilities, []);
  assert.ok(!('world' in r));
  if (code)
    assert.ok(
      r.issues.some((e) => e.code === code),
      JSON.stringify(r),
    );
}
test('two-role authored opening is actually compiled, source-linked, safe and deterministic given the same caller IDs', () => {
  const c = content(),
    before = structuredClone(c),
    a = compiled(input(c)),
    b = compiled(input(c));
  assert.deepEqual(a, b);
  assert.deepEqual(c, before);
  assert.deepEqual(a.capabilities, ['publication.opening.v1']);
  assert.equal(a.world.version, 0);
  assert.equal(a.world.actors.length, 2);
  assert.equal(a.opening.kind, 'publication_opening');
  assert.ok(!('officialLife' in a.world));
  assert.ok(!('publicationId' in a.origin));
  assert.deepEqual(a.origin, input().origin);
  assert.ok(!JSON.stringify(a).includes('SECRET_DIRECTOR_SCRIPT_NOT_A_FACT'));
});
test('each real actorContext gets only its own Persona and explicitly authorized initial knowledge', () => {
  const r = compiled(input());
  const a = r.keys.actors.find((e) => e.key === 'a_first')!,
    b = r.keys.actors.find((e) => e.key === 'b_second')!;
  const ca = actorContext(r.world, a.id),
    cb = actorContext(r.world, b.id);
  const sa = JSON.stringify(ca),
    sb = JSON.stringify(cb);
  for (const marker of [
    'PRIVATE_A_BACKGROUND',
    'PRIVATE_A_MOTIVE',
    'PRIVATE_A_VOICE',
    'PRIVATE_A_BOUNDARY',
    'PRIVATE_A_HISTORY',
    'COMMON_WORLD_FACT_ONLY_A_INITIALLY_KNOWS',
  ])
    assert.ok(sa.includes(marker));
  for (const marker of [
    'PRIVATE_B_BACKGROUND',
    'PRIVATE_B_MOTIVE',
    'PRIVATE_B_VOICE',
    'PRIVATE_B_BOUNDARY',
    'PRIVATE_B_HISTORY',
    'PRIVATE_B_RELATION',
  ])
    assert.ok(sb.includes(marker));
  for (const marker of ['PRIVATE_B_BACKGROUND', 'PRIVATE_B_HISTORY', 'PRIVATE_B_RELATION'])
    assert.ok(!sa.includes(marker));
  for (const marker of [
    'PRIVATE_A_BACKGROUND',
    'PRIVATE_A_HISTORY',
    'COMMON_WORLD_FACT_ONLY_A_INITIALLY_KNOWS',
  ])
    assert.ok(!sb.includes(marker));
  assert.ok(r.world.facts.every((f) => f.visibility.kind !== 'world'));
});
test('opening public identity/contacts/notes never use private Persona or relationship fallback', () => {
  const r = compiled(input()),
    json = JSON.stringify(r.opening);
  assert.ok(!json.includes('PRIVATE_') && !json.includes('SECRET_DIRECTOR'));
  assert.equal(r.opening.contacts[1]?.relationship, '');
  assert.equal(r.opening.contacts[0]?.relationship, '同一班次的同事');
  assert.equal(r.opening.notes[0]?.text, '先商量，再决定');
  assert.deepEqual(r.opening.notes[0]?.factKeys, ['common']);
  assert.ok(!('notes' in r.world));
  assert.ok(!('tradeoff' in r.opening));
  assert.equal(r.opening.identity, '值班员');
});
test('authored historical instants are preserved, chronologically ordered and initially read', () => {
  const r = compiled(input());
  assert.deepEqual(
    r.world.messages.map((m) => m.at),
    ['2026-10-10T08:00:00Z', '2026-10-11T09:00:00Z', '2026-10-12T08:58:00Z'],
  );
  assert.deepEqual(
    r.world.messages.map((m) => m.initialRead),
    [true, true, false],
  );
  assert.ok(
    r.world.messages.every(
      (m) => m.role === 'assistant' && m.sourceEventId === `publication-genesis:${r.world.id}`,
    ),
  );
  assert.equal(r.world.messageHistory?.timeZone, 'UTC+08:00');
});
test('same-instant authored incoming messages do not enter legacy notification reconstruction', () => {
  const c = content();
  c.phone.messages = [
    ...c.phone.messages.filter((m) => m.origin === 'incoming'),
    {
      key: 'incoming_b',
      actorKey: 'b_second',
      origin: 'incoming',
      text: '刚到班上',
      at: c.world.startAt,
    },
  ];
  c.phone.messages[0]!.at = c.world.startAt;
  const r = compiled(input(c));
  assert.deepEqual(
    openingMessagesForDisplay(r.world.messages, r.world.id, r.world.time),
    r.world.messages,
  );
  assert.ok(r.world.messages.every((m) => m.at === c.world.startAt));
});
test('calendar remains proposed and references actual allocated source message, without player actions', () => {
  const r = compiled(input()),
    a = r.world.appointments[0]!;
  assert.equal(a.status, 'proposed');
  assert.equal(a.sourceMessageId, r.keys.messages.find((m) => m.key === 'incoming_a')?.id);
  assert.equal(a.at, '2026-10-12T11:00:00Z');
  assert.ok(!('responseAt' in a));
  assert.ok(!('choices' in r.world));
  assert.ok(!('matters' in r.world));
});
test('space uses real caller seed source and does not infer NPC presence from past participation or an invite', () => {
  const i = input(),
    r = compiled(i);
  assert.equal(r.world.space?.currentPlaceId, 'station');
  assert.deepEqual(r.world.space?.positionSource, {
    kind: 'seed_genesis',
    seedId: i.seedId,
    snapshotVersion: 0,
  });
  assert.ok(r.world.space?.places.every((p) => p.contactActorIds.length === 0));
  assert.deepEqual(r.world.space?.places.find((p) => p.id === 'yard')?.appointmentIds, [
    r.world.appointments[0]!.id,
  ]);
});
test('actor and place constructor keys stay in separate maps; same-named actors never merge', () => {
  const c = content();
  c.actors[1]!.key = 'constructor';
  c.initialKnowledge[1]!.actorKey = 'constructor';
  c.history[2]!.actorKeys = ['constructor'];
  c.history[2]!.visibility = { kind: 'actors', actorKeys: ['constructor'] };
  c.history[0]!.actorKeys = ['a_first', 'constructor'];
  c.relationships[1]!.to = { kind: 'actor', actorKey: 'constructor' };
  c.relationships[1]!.visibility = { kind: 'actors', actorKeys: ['constructor'] };
  c.phone.messages[1]!.actorKey = 'constructor';
  c.places[1]!.key = 'constructor';
  c.routes[0]!.toPlaceKey = 'constructor';
  c.phone.invitations[0]!.placeKey = 'constructor';
  const r = compiled(input(c));
  assert.equal(r.world.actors.length, 2);
  assert.equal(r.world.actors[0]?.name, r.world.actors[1]?.name);
  assert.notEqual(r.keys.actors.find((a) => a.key === 'constructor')?.id, 'constructor');
  assert.equal(r.world.space?.places.find((p) => p.id === 'constructor')?.id, 'constructor');
});
test('12 variable actors can compile without old six-actor/three-notification restrictions', () => {
  const c = content();
  for (let n = 2; n < 12; n++)
    c.actors.push({
      ...structuredClone(c.actors[0]!),
      key: `extra_${n}`,
      publicCard: { traits: [] },
      privatePersona: {
        background: `PERSON_${n}`,
        motivation: '自己的愿望',
        voice: '平和',
        boundaries: '自己的边界',
      },
    });
  const r = compiled(input(c));
  assert.equal(r.world.actors.length, 12);
  assert.equal(new Set(r.world.actors.map((a) => a.id)).size, 12);
  assert.equal(r.world.messages.length, 3);
  assert.equal(r.opening.contacts.length, 12);
});
test('two owners/worlds receive disjoint real allocated IDs and never alias initial arrays', () => {
  const a = compiled(input()),
    b = compiled(input(content(), 1000));
  const ids = new Set(a.world.actors.map((x) => x.id));
  assert.ok(b.world.actors.every((x) => !ids.has(x.id)));
  assert.notEqual(a.world.ownerId, b.world.ownerId);
  b.world.actors[0]!.persona = 'changed';
  assert.ok(a.world.actors[0]!.persona.includes('PRIVATE_A_BACKGROUND'));
});
test('generated entity IDs must be UUIDs and cannot collide with a trusted existing ID or each other', () => {
  for (const make of [
    () => '',
    () => 'actor_alias',
    () => input().worldId,
    () => input().seedId,
    () => input().origin.workId,
    () => '50000000-0000-4000-8000-000000000001',
  ]) {
    const i = input();
    i.newId = make;
    noCompile(i, 'invalid');
  }
});
const unsupportedCases: [string, (c: PublicationContent) => void, string][] = [
  [
    'legacy scene media reference',
    (c) => {
      c.media.push({
        key: 'image',
        asset: { namespace: 'publication', key: 'asset', revision: 1 },
        use: 'scene',
        depiction: 'illustration',
        label: '图片',
        visibility: { kind: 'world' },
      });
      c.places[0]!.sceneMediaKey = 'image';
    },
    'unsupported_media',
  ],
  [
    'runtime extension',
    (c) => {
      c.extensions.push({
        namespace: 'author.unsupported',
        version: 1,
        purpose: 'runtime_required',
        description: '需要新执行器',
        data: { operation: 'future' },
      });
    },
    'unsupported_runtime_extension',
  ],
  [
    'unknown actor isolation',
    (c) => {
      c.actors[1]!.knownAtStart = false;
      c.phone.messages = c.phone.messages.filter((m) => m.actorKey !== 'b_second');
    },
    'unsupported_unknown_actor_projection',
  ],
  [
    'unsourced initial note',
    (c) => {
      c.phone.notes[0]!.factKeys = [];
    },
    'notes_need_known_fact_basis',
  ],
  [
    'long route',
    (c) => {
      c.routes[0]!.minutes = 121;
    },
    'space_route_budget',
  ],
  [
    'long place name',
    (c) => {
      c.places[0]!.name = '名'.repeat(81);
    },
    'space_name_budget',
  ],
  [
    'too many public places',
    (c) => {
      for (let n = 2; n < 17; n++)
        c.places.push({
          key: `place_${n}`,
          name: '地点',
          description: '明确地点',
          knownAtStart: true,
        });
    },
    'space_place_budget',
  ],
];
for (const [name, change, code] of unsupportedCases)
  test('unsupported feature is explicitly rejected before allocating IDs: ' + name, () => {
    const c = content();
    change(c);
    const i = input(c);
    let allocations = 0;
    i.newId = () => {
      allocations++;
      throw Error('must not allocate');
    };
    noCompile(i, 'unsupported', code);
    assert.equal(allocations, 0);
  });
test('editorial extensions are stored elsewhere, never become facts, Persona, notes or actions', () => {
  const c = content();
  c.extensions.push({
    namespace: 'author.music',
    version: 1,
    purpose: 'editorial',
    description: '保留原稿',
    data: { favorite: 'EXTENSION_ONLY_SECRET' },
  });
  const r = compiled(input(c));
  assert.ok(!JSON.stringify(r).includes('EXTENSION_ONLY_SECRET'));
  assert.deepEqual(r.capabilities, ['publication.opening.v1']);
});
test('private overall author manuscript is retained in publication content but never enters the player or NPC world', () => {
  const c = content();
  c.extensions.push({
    namespace: 'parallel_life.authoring_overall',
    version: 1,
    purpose: 'editorial',
    description: '作者总体设定原稿',
    data: { text: 'OVERALL_PRIVATE_SECRET，结局和动机仅供编剧核对' },
  });
  const r = compiled(input(c));
  assert.ok(!JSON.stringify(r).includes('OVERALL_PRIVATE_SECRET'));
  assert.ok(JSON.stringify(c).includes('OVERALL_PRIVATE_SECRET'));
});
test('raw malformed content, unauthorized note facts and future history do not compile', () => {
  const i = input();
  i.content = { ...content(), schemaVersion: 2 };
  noCompile(i, 'invalid');
  const c = content();
  c.phone.notes[0]!.factKeys = ['b_secret'];
  const n = input();
  n.content = c;
  noCompile(n, 'invalid');
  const f = content();
  f.history[0]!.occurredAt = '2026-10-13T00:00:00Z';
  const h = input();
  h.content = f;
  noCompile(h, 'invalid');
});
test('content getters and runtime metadata getters reject without evaluating them', () => {
  let calls = 0;
  const c = content();
  Object.defineProperty(c.world, 'hiddenContext', {
    enumerable: true,
    get() {
      calls++;
      return 'not read';
    },
  });
  const i = input();
  i.content = c;
  noCompile(i, 'invalid');
  const meta = input();
  Object.defineProperty(meta.origin, 'workId', {
    enumerable: true,
    get() {
      calls++;
      return 'not read';
    },
  });
  noCompile(meta, 'invalid');
  const allocator = input();
  Object.defineProperty(allocator, 'newId', {
    enumerable: true,
    get() {
      calls++;
      return () => '';
    },
  });
  noCompile(allocator, 'invalid');
  assert.equal(calls, 0);
});
test('trusted origin uses work/version composite identity with strict bounded fields, not a publication UUID', () => {
  const base = input();
  for (const value of [
    { ...base.origin, publicationVersion: 0 },
    { ...base.origin, draftVersion: -1 },
    { ...base.origin, contentHash: 'not-a-hash' },
    { ...base.origin, publicationId: '50000000-0000-4000-8000-000000000001' },
  ])
    noCompile({ ...input(), origin: value }, 'invalid');
});
test('world/owner/seed identity must be valid and distinct', () => {
  const i = input();
  noCompile({ ...i, ownerId: 'guest-alias' }, 'invalid');
  noCompile({ ...i, seedId: i.worldId }, 'invalid');
});
test('oversized authorized initial history rejects instead of being silently dropped by the real context builder', () => {
  const c = content();
  for (let n = 0; n < 6; n++) {
    const key = `long_${n}`;
    c.history.push({
      key,
      kind: 'established_fact',
      text: '史'.repeat(900),
      occurredAt: '2026-10-10T00:00:00Z',
      actorKeys: ['a_first'],
      visibility: { kind: 'actors', actorKeys: ['a_first'] },
    });
    c.initialKnowledge[0]!.factKeys.push(key);
  }
  noCompile(input(c), 'unsupported', 'actor_history_budget');
});
test('long complete private Persona is preserved; exceeding serialization budget rejects without truncation', () => {
  const c = content();
  c.actors[0]!.privatePersona.background = 'A'.repeat(1200);
  c.actors[0]!.privatePersona.motivation = 'B'.repeat(600);
  c.actors[0]!.privatePersona.voice = 'C'.repeat(600);
  c.actors[0]!.privatePersona.boundaries = 'D'.repeat(600);
  const r = compiled(input(c));
  assert.ok(r.world.actors[0]!.persona.includes('A'.repeat(1200)));
  c.actors[0]!.privatePersona.background = '\n'.repeat(1199) + 'x';
  noCompile(input(c), 'unsupported', 'persona_budget');
  assert.ok(PUBLICATION_GENESIS_MAX_BYTES <= 65536);
});
test('safe metadata can be consumed by current phone shape without exposing the internal compiled world', () => {
  const i = input(),
    r = compiled(i);
  const phone = WorldPhoneSchema.parse({
    id: r.world.id,
    seedId: i.seedId,
    title: r.world.title,
    time: r.world.time,
    identity: r.opening.identity,
    setting: r.opening.setting,
    actors: r.opening.contacts.map((a) => ({
      id: a.actorId,
      name: a.name,
      relationship: a.relationship,
      summary: a.identity,
    })),
    messages: r.world.messages.map((m) => ({
      id: m.id,
      actorId: m.actorId,
      text: m.text,
      at: m.at,
      role: m.role,
      initialRead: m.initialRead,
      ...(m.history ? { origin: 'fictional_history' } : {}),
    })),
    notes: [],
  });
  assert.ok(!JSON.stringify(phone).includes('PRIVATE_'));
  assert.equal(phone.actors.length, 2);
});

test('total compiled world/metadata/key budget refuses a valid large authored opening without truncating it', () => {
  const c = content();
  for (let n = 2; n < 16; n++)
    c.places.push({ key: `place_${n}`, name: '地点', description: '已知地点', knownAtStart: true });
  c.routes = [];
  for (const from of c.places)
    for (const to of c.places) {
      if (from.key !== to.key && c.routes.length < 64)
        c.routes.push({ fromPlaceKey: from.key, toPlaceKey: to.key, minutes: 10 });
    }
  c.phone.notes = Array.from({ length: 12 }, (_, n) => ({
    key: `note_${n}`,
    title: '开局记录',
    text: '记'.repeat(1200),
    factKeys: ['common'],
  }));
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
  noCompile(input(c), 'unsupported', 'world_budget');
  assert.equal(c.phone.notes[0]!.text.length, 1200);
});

test('a private draft trial uses version zero and explicit trial provenance, never a fake published identity', () => {
  const i = input();
  i.originKind = 'trial';
  i.origin.publicationVersion = 0;
  const r = compiled(i);
  assert.equal(r.opening.originKind, 'trial');
  assert.deepEqual(r.seedMetadata, { source: 'publication_trial', origin: i.origin });
  assert.equal(r.origin.publicationVersion, 0);
  assert.deepEqual(r.capabilities, ['publication.opening.v1']);
  assert.ok(!('story' in r.seedMetadata));
});
test('published and trial origin versions cannot be exchanged or inferred from a caller title', () => {
  const published = input();
  noCompile({ ...published, origin: { ...published.origin, publicationVersion: 0 } }, 'invalid');
  const trial = input();
  trial.originKind = 'trial';
  noCompile(trial, 'invalid');
  const ready = compiled(input());
  assert.equal(ready.seedMetadata.source, 'published_work');
});

test('real actorContext receives explicit public world and protagonist identity, not just phone metadata', () => {
  const c = content();
  c.world.publicSetting = 'PUBLIC_WORLD_SETTING_VISIBLE_TO_NPC';
  c.protagonist.identity = 'PUBLIC_PLAYER_IDENTITY_VISIBLE_TO_NPC';
  c.protagonist.situation = 'PRIVATE_PLAYER_SITUATION_MUST_NOT_ENTER_NPC';
  const r = compiled(input(c));
  for (const a of r.world.actors) {
    const ctx = actorContext(r.world, a.id);
    const p = JSON.parse(ctx.actor.persona);
    assert.equal(p.publicSetting, c.world.publicSetting);
    assert.equal(p.protagonistPublicIdentity, c.protagonist.identity);
    const text = JSON.stringify(ctx);
    assert.ok(!text.includes(c.protagonist.situation));
    assert.ok(!text.includes(c.world.hiddenContext));
    const other = r.world.actors.find((b) => b.id !== a.id)!;
    assert.ok(!text.includes(JSON.parse(other.persona).background));
  }
  assert.equal(r.opening.situation, c.protagonist.situation); // player's own phone metadata remains separate.
});
test('public world and identity additions count toward the original Persona budget, never truncate', () => {
  const c = content();
  c.actors[0]!.privatePersona.background = 'A'.repeat(1200);
  c.actors[0]!.privatePersona.motivation = 'B'.repeat(600);
  c.actors[0]!.privatePersona.voice = 'C'.repeat(600);
  c.actors[0]!.privatePersona.boundaries = 'D'.repeat(600);
  c.world.publicSetting = 'S'.repeat(1000);
  c.protagonist.identity = 'I'.repeat(200);
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
  noCompile(input(c), 'unsupported', 'persona_budget');
  assert.equal(c.world.publicSetting.length, 1000);
  assert.equal(c.actors[0]!.privatePersona.background.length, 1200);
});
test('repeated public world data for 12 actors still respects the original 65KB total budget', () => {
  const c = content();
  for (let n = 2; n < 12; n++)
    c.actors.push({ ...structuredClone(c.actors[0]!), key: `more_${n}` });
  c.world.publicSetting = '世'.repeat(1600);
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, true);
  noCompile(input(c), 'unsupported', 'world_budget');
});

test('eligible authored timeline stays out of genesis facts and initial phone messages', () => {
  const c = content();
  c.timeline = {
    initialStageKey: 'start',
    stages: [{ key: 'start', title: '阶段', order: 0, afterStageKeys: [] }],
  };
  c.candidates.push({
    key: 'future',
    kind: 'candidate',
    title: '未发生的机会',
    editorialIntent: 'FUTURE_NOT_A_FACT',
    actorKeys: ['a_first'],
    timeline: {
      stageKey: 'start',
      excludeIfResolved: [],
      alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
    },
    prerequisites: [],
    mutuallyExclusiveNodeKeys: [],
    intent: { kind: 'offer_message', actorKey: 'a_first', text: 'FUTURE_NOT_A_MESSAGE' },
  });
  const r = compiled(input(c));
  assert.ok(r.capabilities.includes('publication.timeline.v1'));
  assert.ok(r.capabilities.includes('candidate.offer_message.v1'));
  assert.ok(!JSON.stringify(r.world).includes('FUTURE_NOT_A_'));
  assert.equal(r.world.messages.length, 3);
});

test('unsupported full-event completion prerequisites are blocked without changing author intent', () => {
  const c = content();
  const event = {
    key: 'event_a',
    kind: 'candidate' as const,
    title: '主角面临的事',
    editorialIntent: '由导演开启事件',
    actorKeys: ['a_first'],
    prerequisites: [],
    mutuallyExclusiveNodeKeys: [],
    intent: { kind: 'director_event' as const, actorKey: 'a_first' },
  };
  c.candidates = [
    event,
    {
      ...event,
      key: 'event_b',
      prerequisites: [{ kind: 'after_committed_node', nodeKey: 'event_a' }],
    },
  ];
  noCompile(input(c), 'unsupported', 'unsupported_director_completion_dependency');
  c.candidates[1]!.prerequisites = [{ kind: 'after_presented_node', nodeKey: 'event_a' }];
  assert.equal(compilePublicationGenesis(input(c)).status, 'compiled');
  c.candidates[1]!.prerequisites = [];
  c.conditions = [
    {
      key: 'completed_group',
      title: '前一事件的进展',
      match: 'all',
      prerequisites: [
        { kind: 'after_committed_node', nodeKey: 'event_a' },
        { kind: 'after_presented_node', nodeKey: 'event_a' },
      ],
    },
  ];
  c.candidates[1]!.conditionKeys = ['completed_group'];
  noCompile(input(c), 'unsupported', 'unsupported_director_completion_dependency');
  c.conditions[0]!.match = 'any';
  assert.equal(compilePublicationGenesis(input(c)).status, 'compiled');
  c.conditions[0]!.prerequisites = [{ kind: 'after_committed_node', nodeKey: 'event_a' }];
  noCompile(input(c), 'unsupported', 'unsupported_director_completion_dependency');
  delete c.conditions;
  delete c.candidates[1]!.conditionKeys;
  c.timeline = {
    initialStageKey: 'first',
    stages: [
      { key: 'first', title: '之前', order: 0, afterStageKeys: [] },
      { key: 'second', title: '之后', order: 1, afterStageKeys: ['first'] },
    ],
  };
  c.candidates[0]!.timeline = {
    stageKey: 'first',
    excludeIfResolved: [],
    alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
  };
  c.candidates[1]!.timeline = {
    stageKey: 'second',
    excludeIfResolved: [],
    alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
  };
  noCompile(input(c), 'unsupported', 'unsupported_director_completion_stage');
});
