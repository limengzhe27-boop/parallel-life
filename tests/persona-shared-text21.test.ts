import test from 'node:test';
import assert from 'node:assert/strict';
import { shareIdenticalPersonaModules } from '../src/modules/world/domain/actor-situation.ts';

test('identical persona modules retain every dimension, verbatim core, boundaries and original source', () => {
  const core = '嘴硬但关心玩家；工作严肃，对妹妹温柔，拒绝后尊重界限。'.repeat(20);
  const original = {
    modules: {
      lifeContext: core,
      traits: core,
      drives: '想被理解',
      behavior: '短句，不替人决定',
      relationships: '妹妹与同事不同',
    },
    boundaries: '不披露秘密',
    publicPremise: '作者原设定',
  };
  const source = JSON.stringify(original);
  const result = JSON.parse(shareIdenticalPersonaModules(source));
  assert.deepEqual(Object.keys(result.modules), Object.keys(original.modules));
  assert.equal(result.modules.traits, core);
  assert.match(result.modules.lifeContext, /modules.traits.*同时按两种维度理解/);
  result.modules.lifeContext = result.modules.traits;
  assert.deepEqual(result, original, 'expanding the shared original restores every supplied value');
  assert.equal(JSON.stringify(original), source);
  assert.ok(shareIdenticalPersonaModules(source).length < source.length);
  assert.equal(
    shareIdenticalPersonaModules(shareIdenticalPersonaModules(source)),
    shareIdenticalPersonaModules(source),
  );
});

test('different persona meaning, short repeated labels and unsupported shapes remain verbatim', () => {
  const a = '愿意参加周五聚餐。'.repeat(30);
  for (const source of [
    '普通人设',
    'null',
    '{}',
    JSON.stringify({ modules: [] }),
    JSON.stringify({ modules: { lifeContext: a, traits: a.replace('愿意', '不愿意') } }),
    JSON.stringify({ modules: { traits: '关心', drives: '关心' } }),
  ])
    assert.equal(shareIdenticalPersonaModules(source), source);
});
