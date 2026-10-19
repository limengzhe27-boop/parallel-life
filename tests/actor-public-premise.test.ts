import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actorSnapshotPersona,
  projectActorPublicPremise,
} from '../src/modules/world/domain/actor-public-premise.ts';
import {
  selectActorPersona,
  legacyPersonaExcerpt,
} from '../src/modules/world/domain/actor-situation.ts';

const sourceId = 'definition:' + 'a'.repeat(64);
const original = {
  publicSetting: '河边小店正在筹备试营业。玩家是合伙人。阿宁负责陈列，阿澄负责预算。',
  protagonistPublicIdentity: '小店合伙人',
  hiddenContext: 'SECRET_BACKSTORY',
  overallSetting: 'SECRET_FULL_MANUSCRIPT',
  otherActorPlan: 'SECRET_OTHER_PLAN',
  currentPlayerPosition: 'SECRET_REAL_LOCATION',
};
const modules = {
  lifeContext: '本人负责陈列',
  traits: '外向',
  drives: '希望角落有生活气息',
  behavior: '先讲具体事情',
  relationships: '熟悉平等的合伙人',
};

test('primary five dimensions and explicit public premise coexist in the exact snapshot persona serializer', () => {
  const selected = selectActorPersona(modules, '临窗区域');
  const persona = actorSnapshotPersona({
    persona: JSON.stringify(original),
    modules: selected,
    relationship: '合伙人',
    definitionSourceId: sourceId,
    topic: '临窗区域',
  });
  const parsed = JSON.parse(persona);
  assert.deepEqual(parsed.modules, selected);
  assert.equal(parsed.relationship, '合伙人');
  assert.equal(parsed.publicPremise.publicSetting, original.publicSetting);
  assert.equal(parsed.publicPremise.protagonistPublicIdentity, original.protagonistPublicIdentity);
  assert.equal(parsed.publicPremise.identity.sourceId, sourceId);
  assert.equal(parsed.publicPremise.identity.authority, 'public_background_only');
  assert.match(parsed.publicPremise.boundary, /不证明当前事件、实时位置/);
  assert(!persona.includes('SECRET_'));
  assert.equal(
    parsed.persona,
    undefined,
    'do not reintroduce the entire legacy persona alongside primary modules',
  );
  assert.equal(original.hiddenContext, 'SECRET_BACKSTORY');
  assert.deepEqual(modules.lifeContext, '本人负责陈列');
});

test('whitelist never recursively discovers secrets or accepts object-valued public fields', () => {
  assert.equal(
    projectActorPublicPremise(
      JSON.stringify({ hiddenContext: original.hiddenContext, world: { publicSetting: 'nested' } }),
      sourceId,
      '',
    ),
    undefined,
  );
  assert.equal(
    projectActorPublicPremise(
      JSON.stringify({
        publicSetting: { text: 'not a public string' },
        protagonistPublicIdentity: [],
      }),
      sourceId,
      '',
    ),
    undefined,
  );
  const result = projectActorPublicPremise(
    JSON.stringify({ ...original, private: { publicSetting: 'PRIVATE_NESTED' } }),
    sourceId,
    '',
  );
  assert.deepEqual(
    Object.keys(result!).sort(),
    ['identity', 'boundary', 'protagonistPublicIdentity', 'publicSetting'].sort(),
  );
  assert(!JSON.stringify(result).includes('PRIVATE_NESTED'));
});

test('malformed, unstructured, missing public fields and malformed definition handle do not manufacture background', () => {
  for (const persona of [
    'not JSON',
    '{',
    'null',
    '[]',
    '"a string"',
    '{}',
    JSON.stringify({ publicSetting: '  ', protagonistPublicIdentity: null }),
  ])
    assert.equal(projectActorPublicPremise(persona, sourceId, ''), undefined);
  assert.equal(
    projectActorPublicPremise(JSON.stringify(original), 'definition:invented', ''),
    undefined,
  );
});

test('long background stays a bounded excerpt with explicit provenance and intact authority boundary', () => {
  const publicSetting = '公开开端。' + '店铺筹备。'.repeat(800) + '临窗区域要保留座位。';
  const result = projectActorPublicPremise(
    JSON.stringify({
      publicSetting,
      protagonistPublicIdentity: '合伙人'.repeat(200),
      hiddenContext: 'SECRET_FULL',
    }),
    sourceId,
    '临窗区域',
  );
  assert(result!.publicSetting!.length <= 1800);
  assert(result!.protagonistPublicIdentity!.length <= 240);
  assert.deepEqual(result!.excerptedFields, ['publicSetting', 'protagonistPublicIdentity']);
  assert.equal(result!.identity.sourceId, sourceId);
  assert(!JSON.stringify(result).includes('SECRET_FULL'));
  const persona = actorSnapshotPersona({
    persona: JSON.stringify({ publicSetting }),
    modules: selectActorPersona(modules, ''),
    definitionSourceId: sourceId,
    topic: '',
  });
  const compact = JSON.parse(legacyPersonaExcerpt(persona, '', 1100));
  assert.equal(compact.publicPremise.identity.sourceId, sourceId);
  assert.equal(compact.publicPremise.identity.authority, 'public_background_only');
  assert(compact.publicPremise.publicSetting.length > 0);
  assert.equal(
    compact.publicPremise.boundary,
    result!.boundary,
    'existing persona compaction protects the background authority boundary',
  );
});

test('legacy-only snapshot representation remains unchanged and no paid saved object is mutated', () => {
  const input = {
    persona: JSON.stringify(original),
    relationship: '合伙人',
    modules: undefined,
    definitionSourceId: sourceId,
    topic: '',
  };
  assert.equal(
    actorSnapshotPersona(input),
    JSON.stringify({
      persona: input.persona,
      relationship: input.relationship,
      modules: undefined,
    }),
  );
  const saved = Object.freeze({
    actor: Object.freeze({ persona: '{"modules":{"traits":"old saved persona"}}' }),
  });
  const copy = structuredClone(saved);
  actorSnapshotPersona({ ...input, modules });
  assert.deepEqual(saved, copy);
});

test('model 4000-character structured excerpt retains public premise beside all long modules', () => {
  const longModules = Object.fromEntries(
    Object.entries(modules).map(([key, text]) => [key, text.repeat(800)]),
  );
  const selected = selectActorPersona(longModules, '临窗');
  const persona = actorSnapshotPersona({
    persona: JSON.stringify(original),
    modules: selected,
    definitionSourceId: sourceId,
    topic: '临窗',
  });
  assert(persona.length > 4000);
  const compact = JSON.parse(legacyPersonaExcerpt(persona, '临窗', 4000));
  assert.deepEqual(Object.keys(compact.modules).sort(), Object.keys(modules).sort());
  assert.equal(compact.publicPremise.publicSetting, original.publicSetting);
  assert.equal(compact.publicPremise.protagonistPublicIdentity, original.protagonistPublicIdentity);
  assert.equal(compact.publicPremise.identity.sourceId, sourceId);
  assert.equal(compact.publicPremise.identity.authority, 'public_background_only');
  assert(!JSON.stringify(compact).includes('SECRET_'));
});
