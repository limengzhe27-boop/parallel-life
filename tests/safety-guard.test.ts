import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectCrisisIntent, CRISIS_HOTLINES, CRISIS_RESPONSE } from '../src/modules/ai/safety-guard.ts';
import { rejectReason } from '../src/modules/profile/application/fact-quality.ts';

describe('AUD-19 AI 内容安全与危机干预守卫', () => {
  it('识别自杀倾向并返回危机干预与心理热线', () => {
    const inputs = [
      '活着好累，我真的想自杀了',
      '准备跳楼了，解脱一下',
      '我想死，不想留在这个世界上了',
      '用刀割腕',
    ];
    for (const input of inputs) {
      const result = detectCrisisIntent(input);
      assert.equal(result.isCrisis, true, `Should detect crisis for: "${input}"`);
      assert.ok(result.interventionText?.includes('400-161-9995'), 'Should contain 24h hotline');
    }
  });

  it('识别自残倾向', () => {
    const result = detectCrisisIntent('我刚才又忍不住拿刀自残了');
    assert.equal(result.isCrisis, true);
    assert.equal(result.reason, 'self_harm');
  });

  it('正常情绪倾诉不误伤为危机', () => {
    const normals = [
      '今天加班太累了，想早点睡',
      '这次考试没考好，有点难过',
      '我想去西藏看看雪山',
      '如果不做程序员，我可能会去开一家咖啡馆',
    ];
    for (const text of normals) {
      const result = detectCrisisIntent(text);
      assert.equal(result.isCrisis, false, `Should NOT detect crisis for: "${text}"`);
    }
  });

  it('危机意图绝不被提炼为档案事实或经历（rejectReason 返回 CRISIS_GUARDED）', () => {
    const existing = { facts: [], events: [] };
    const reason = rejectReason(
      { category: 'personality', text: '经常想自杀结束生命' },
      existing,
    );
    assert.equal(reason, 'CRISIS_GUARDED');
  });

  it('包含全国正规心理危机援助热线', () => {
    assert.ok(CRISIS_HOTLINES.length >= 3);
    assert.ok(CRISIS_HOTLINES.some((h) => h.phone === '400-161-9995'));
  });
});
