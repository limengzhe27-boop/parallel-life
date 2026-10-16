import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  compileAuthoredAgentMaterials,
  type AuthoredAgentMaterial,
  type AuthoredMaterialNode,
  type AuthoredMaterialSourceDocument,
} from '../src/modules/world/domain/authored-agent-material.ts';
import { projectActorEpisodeDirective } from '../src/modules/world/domain/actor-episode-intent.ts';

const actorA = 'world-actor-a';
const actorB = 'world-actor-b';
const earliestAt = '2040-03-12T18:30:00.000Z';
const places = [{ id: 'cafe', name: '本人已知的咖啡馆' }];
const message = (): Extract<AuthoredMaterialNode['intent'], { kind: 'offer_message' }> => ({
  kind: 'offer_message',
  actorKey: 'author-a',
  text: '  下次方便时聊聊那本书？\n不着急。  ',
});
const invitation = (): Extract<AuthoredMaterialNode['intent'], { kind: 'offer_invitation' }> => ({
  kind: 'offer_invitation',
  actorKeys: ['author-a'],
  placeKey: 'cafe',
  title: '一起讨论那本书',
  earliestAt,
});

function source(
  intent: AuthoredMaterialNode['intent'] = message(),
): AuthoredMaterialSourceDocument {
  return {
    origin: { workId: 'work', publicationVersion: 3, draftVersion: 7, contentHash: 'a'.repeat(64) },
    openingEventKey: 'opening',
    timeline: null,
    actorKeys: ['author-a', 'author-b'],
    contacts: [
      { actorKey: 'author-a', actorId: actorA },
      { actorKey: 'author-b', actorId: actorB },
    ],
    initialActorIds: [actorA, actorB],
    initialPlaceKeys: ['cafe'],
    places: [
      { key: 'cafe', name: '作者地点标题不可代替本人地图名称' },
      { key: 'hidden', name: '未开放秘密地点' },
    ],
    history: [],
    nodes: [
      {
        key: 'opening',
        kind: 'candidate',
        title: '不应下传的全局节点标题',
        editorialIntent: '不应下传的导演动机',
        script: '不应下传的他人私聊和全局秘密',
        sceneText: '不应下传的未来结果',
        scenePlaceKeys: ['hidden'],
        actorKeys: ['author-a', 'author-b'],
        settingPlaceKey: 'hidden',
        placeKey: 'hidden',
        prerequisites: [],
        mutuallyExclusiveNodeKeys: [],
        intent,
        direction: {
          mode: 'required',
          expectedImpact: '不能作为本人已经承诺的结果',
          experience: '导演审计说明',
          progress: { pace: 'extended', refusal: 'withdraw' },
        },
        timeline: {
          stageKey: 'secret-stage',
          window: { notBefore: earliestAt, expiresAt: '2040-03-12T19:00:00.000Z' },
          timeNote: '不应下传的导演时间安排',
          excludeIfResolved: [],
          alternatives: { onDeclined: ['secret-alternative'], onSkipped: [], onExpired: [] },
        },
      },
    ],
  };
}

function compile(
  raw: AuthoredMaterialSourceDocument,
  actualActorIds = [actorA, actorB],
  actualPlaceIds = ['cafe'],
): AuthoredAgentMaterial {
  return compileAuthoredAgentMaterials(
    {
      scope: { worldId: 'world', engineEpoch: 2, worldVersion: 9 },
      source: raw,
      actualActorIds,
      actualPlaceIds,
    },
    (json) => createHash('sha256').update(json).digest('hex'),
  ).materials[0]!;
}

test('an exact author message goes only to its explicit mapped actor, including an opening', () => {
  const material = compile(source());
  assert.equal(material.role, 'opening');
  assert.deepEqual(projectActorEpisodeDirective(material, actorA, places), {
    kind: 'message_suggestion',
    text: '  下次方便时聊聊那本书？\n不着急。  ',
  });
  assert.equal(projectActorEpisodeDirective(material, actorB, places), null);
  assert.equal(projectActorEpisodeDirective(material, 'outsider', places), null);
});

test('changing the explicit author target changes the recipient, not the participant list', () => {
  const raw = source({ kind: 'offer_message', actorKey: 'author-b', text: '只给乙的开场建议' });
  const material = compile(raw);
  assert.equal(projectActorEpisodeDirective(material, actorA, places), null);
  assert.deepEqual(projectActorEpisodeDirective(material, actorB, places), {
    kind: 'message_suggestion',
    text: '只给乙的开场建议',
  });
});

for (const intent of [
  { kind: 'editorial_only' },
  { kind: 'director_event' },
  { kind: 'director_event', actorKey: 'author-a' },
] satisfies AuthoredMaterialNode['intent'][])
  test(`${JSON.stringify(intent)} never authorizes script or editorial text for participants`, () => {
    const material = compile(source(intent));
    assert.deepEqual(
      material.participantRefs.map((ref) => ref.actorId),
      [actorA, actorB],
    );
    for (const actorId of [actorA, actorB])
      assert.equal(projectActorEpisodeDirective(material, actorId, places), null);
  });

test('a target outside node actorKeys is rejected even when its mapping resolves', () => {
  const raw = source();
  raw.nodes[0]!.actorKeys = ['author-b'];
  const material = compile(raw);
  assert.equal(
    material.participantRefs.find((ref) => ref.actorKey === 'author-a')!.status,
    'resolved',
  );
  assert.equal(projectActorEpisodeDirective(material, actorA, places), null);
});

for (const variant of [
  'missing_contact',
  'duplicate_contact',
  'duplicate_actor_key',
  'shared_actual_actor',
  'outside_initial_namespace',
  'outside_actual_world',
] as const)
  test(`author mapping ${variant} cannot grant a directive`, () => {
    const raw = source();
    let actualActors = [actorA, actorB];
    if (variant === 'missing_contact') raw.contacts.shift();
    if (variant === 'duplicate_contact') raw.contacts.push({ ...raw.contacts[0]! });
    if (variant === 'duplicate_actor_key') raw.actorKeys.push('author-a');
    if (variant === 'shared_actual_actor') raw.contacts[1]!.actorId = actorA;
    if (variant === 'outside_initial_namespace') raw.initialActorIds = [actorB];
    if (variant === 'outside_actual_world') actualActors = [actorB];
    const material = compile(raw, actualActors);
    assert.notEqual(
      material.participantRefs.find((ref) => ref.actorKey === 'author-a')!.status,
      'resolved',
    );
    assert.equal(projectActorEpisodeDirective(material, actorA, places), null);
  });

test('missing, wrong and duplicated resolved participant references are rejected', () => {
  for (const variant of ['missing', 'wrong_actor', 'duplicate'] as const) {
    const material = compile(source());
    if (variant === 'missing') material.participantRefs = material.participantRefs.slice(1);
    if (variant === 'wrong_actor') material.participantRefs[0]!.actorId = actorB;
    if (variant === 'duplicate') material.participantRefs.push({ ...material.participantRefs[0]! });
    assert.equal(projectActorEpisodeDirective(material, actorA, places), null, variant);
  }
});

test('a single actor invitation preserves only an optional future title, lower bound and known place', () => {
  const material = compile(source(invitation()));
  assert.deepEqual(projectActorEpisodeDirective(material, actorA, places), {
    kind: 'invitation_suggestion',
    title: '一起讨论那本书',
    earliestAt,
    placeId: 'cafe',
    placeName: '本人已知的咖啡馆',
  });
  assert.equal(projectActorEpisodeDirective(material, actorB, places), null);
});

for (const actorKeys of [[], ['author-a', 'author-b'], ['author-a', 'author-a']])
  test(`invitation targets ${JSON.stringify(actorKeys)} are unsupported without guessing`, () => {
    const material = compile(source({ ...invitation(), kind: 'offer_invitation', actorKeys }));
    assert.equal(projectActorEpisodeDirective(material, actorA, places), null);
    assert.equal(projectActorEpisodeDirective(material, actorB, places), null);
  });

for (const variant of [
  'unknown_author_place',
  'duplicate_author_place',
  'not_available_in_world',
  'not_available_to_actor',
  'duplicate_available_place',
] as const)
  test(`invitation place ${variant} yields no title, time or hidden location`, () => {
    const raw = source(invitation());
    let actualPlaces = ['cafe'];
    let actorPlaces = places;
    if (variant === 'unknown_author_place') raw.places.shift();
    if (variant === 'duplicate_author_place') raw.places.push({ ...raw.places[0]! });
    if (variant === 'not_available_in_world') actualPlaces = [];
    if (variant === 'not_available_to_actor') actorPlaces = [];
    if (variant === 'duplicate_available_place') actorPlaces = [...places, { ...places[0]! }];
    const material = compile(raw, [actorA, actorB], actualPlaces);
    assert.equal(projectActorEpisodeDirective(material, actorA, actorPlaces), null);
  });

test('resolved but hidden places are not disclosed despite the global script referring to them', () => {
  const material = compile(
    source({
      ...invitation(),
      kind: 'offer_invitation',
      actorKeys: ['author-a'],
      placeKey: 'hidden',
    }),
  );
  assert.deepEqual(
    material.placeRefs.find((ref) => ref.placeKey === 'hidden'),
    {
      placeKey: 'hidden',
      placeId: 'hidden',
      status: 'resolved',
      availableInWorld: false,
    },
  );
  assert.equal(projectActorEpisodeDirective(material, actorA, places), null);
});

test('missing or duplicated place references cannot select an arbitrary matching location', () => {
  for (const variant of ['missing', 'duplicate'] as const) {
    const material = compile(source(invitation()));
    const ref = material.placeRefs.find((item) => item.placeKey === 'cafe')!;
    if (variant === 'missing')
      material.placeRefs = material.placeRefs.filter((item) => item !== ref);
    else material.placeRefs.push({ ...ref });
    assert.equal(projectActorEpisodeDirective(material, actorA, places), null, variant);
  }
});

test('a message does not disclose locations and needs no location to make its own suggestion', () => {
  assert.deepEqual(
    projectActorEpisodeDirective(compile(source(), [actorA, actorB], []), actorA, []),
    {
      kind: 'message_suggestion',
      text: '  下次方便时聊聊那本书？\n不着急。  ',
    },
  );
});

for (const intent of [message(), invitation()])
  test(`${intent.kind} projects a whitelist, never manuscript or director extensions`, () => {
    const material = compile(source(intent));
    Object.assign(material, {
      directorAudit: 'private audit',
      transcript: ['another actor private chat'],
    });
    Object.assign(material.node.intent, {
      deadline: 'private deadline',
      accepted: true,
      secret: 'private intent extension',
    });
    Object.defineProperty(material.node, 'privateInterview', {
      get() {
        throw Error('A private extension must never be read');
      },
    });
    const actorPlaces = [
      Object.assign({ ...places[0]! }, { route: 'secret route', currentActorIds: [actorB] }),
    ];
    const result = projectActorEpisodeDirective(material, actorA, actorPlaces);
    assert.deepEqual(
      result,
      intent.kind === 'offer_message'
        ? { kind: 'message_suggestion', text: intent.text }
        : {
            kind: 'invitation_suggestion',
            title: intent.title,
            earliestAt,
            placeId: 'cafe',
            placeName: places[0]!.name,
          },
    );
    assert.equal(JSON.stringify(result).includes('private'), false);
    for (const key of [
      'deadline',
      'expiresAt',
      'at',
      'accepted',
      'arrived',
      'occurredAt',
      'completed',
      'source',
      'node',
      'script',
      'sceneText',
      'editorialIntent',
      'directorAudit',
    ])
      assert.equal(key in result!, false, key);
  });

test('both directive outputs are fresh values detached from source, place and previous output mutation', () => {
  for (const intent of [message(), invitation()]) {
    const material = compile(source(intent));
    const actorPlaces = structuredClone(places);
    const before = structuredClone(material);
    const first = projectActorEpisodeDirective(material, actorA, actorPlaces)!;
    const second = projectActorEpisodeDirective(material, actorA, actorPlaces)!;
    assert.notEqual(first, second);
    assert.deepEqual(first, second);
    if (first.kind === 'message_suggestion') first.text = 'caller mutation';
    else {
      first.title = 'caller mutation';
      first.earliestAt = 'caller mutation';
      first.placeName = 'caller mutation';
    }
    assert.deepEqual(material, before);
    assert.deepEqual(projectActorEpisodeDirective(material, actorA, actorPlaces), second);
    if (material.node.intent.kind === 'offer_message')
      material.node.intent.text = 'source mutation';
    else if (material.node.intent.kind === 'offer_invitation')
      material.node.intent.title = 'source mutation';
    actorPlaces[0]!.name = 'place mutation';
    assert.equal(JSON.stringify(second).includes('mutation'), false);
  }
});
