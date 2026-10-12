import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseActorEditor,
  updateActorInContent,
  createEmptyActor,
  generateActorKey,
  checkActorDeletionSafety,
  deleteActorFromContent,
  splitMotivation,
  joinMotivation,
  isDraftDirty,
  parseWorldSettings,
  updateWorldSettingsInContent,
  parsePlotData,
  deepClone,
} from '../src/features/publisher/publisher-editor.ts';

const mockDraftContent: Record<string, unknown> = {
  schemaVersion: 1,
  world: {
    title: '海边诊所的午后',
    hook: '海风拂过旧街角，秘密与温柔在诊所悄然展开',
    description: '主角来到偏远海滨小镇，在周记诊所遇到熟人与新朋友。',
    experienceNote: '重点体验日常互动与隐藏真相。',
    publicSetting: '偏远海边小镇，医疗条件有限但人情味浓厚。',
    tone: '日常、微悬疑、温情',
    startAt: '初夏六月 午后两点',
    startPlaceKey: 'clinic_front',
    hiddenContext: '周医生掌握十年前事故的关键记录。',
    protagonistIdentity: '返乡青年',
    protagonistSituation: '刚回到海边老家，准备拜访老周诊所。',
  },
  actors: [
    {
      key: 'qingqing',
      name: '青青',
      knownAtStart: true,
      publicCard: {
        identity: '诊所助手',
        appearance: '身穿浅白大褂，长发挽起，眼神清澈而冷静。',
        traits: ['细心', '清冷', '敏锐'],
        avatarMediaKey: 'media_qingqing_01',
      },
      privatePersona: {
        voice: '说话简洁轻柔，习惯用陈述句，情绪很少外露。',
        background: '本地人，祖父曾是老周的合伙医生。',
        motivation: '在乎：诊所的平静与祖父留下的医案\n眼前：查清昨晚私自取药的人是谁',
        boundaries: '讨厌别人翻动内室诊柜，反感轻浮的玩笑。',
      },
    },
    {
      key: 'laozhou',
      name: '老周',
      knownAtStart: true,
      publicCard: {
        identity: '诊所执业医生',
        appearance: '五十来岁，戴老花镜，常穿洗得发白的浅灰色便服。',
        traits: ['随和', '幽默', '深沉'],
      },
      privatePersona: {
        voice: '温和带点幽默，爱用反问句，讲话不急不慢。',
        background: '行医三十余年，看似随和糊涂，实则深谙镇上各家往事。',
        motivation: '在乎：小镇病患的健康与诊所名声\n眼前：说服主角留下来接班',
        boundaries: '不愿提及十年前的医疗意外。',
      },
    },
  ],
  relationships: [
    {
      key: 'rel_player_qingqing',
      from: { kind: 'player' },
      to: { kind: 'actor', actorKey: 'qingqing' },
      description: '青梅竹马 / 邻居',
    },
    {
      key: 'rel_qingqing_laozhou',
      from: { kind: 'actor', actorKey: 'qingqing' },
      to: { kind: 'actor', actorKey: 'laozhou' },
      description: '师徒与雇佣',
    },
  ],
  initialKnowledge: [
    {
      actorKey: 'qingqing',
      factKeys: ['fact_clinic_history', 'fact_secret_formula'],
    },
  ],
  phone: {
    messages: [
      {
        key: 'msg_01',
        actorKey: 'qingqing',
        text: '诊所刚开门，你到了就直接进来。',
      },
    ],
    invitations: [
      {
        key: 'inv_01',
        title: '诊所清点药材',
        actorKeys: ['qingqing'],
      },
    ],
  },
  history: [
    {
      key: 'fact_clinic_history',
      text: '周记诊所是小镇唯一的全科诊所。',
      occurredAt: '五年前',
      actorKeys: ['laozhou'],
    },
  ],
  candidates: [
    {
      key: 'cand_investigate',
      title: '调查药品失窃',
      editorialIntent: '测试主角对青青的信任度',
      actorKeys: ['qingqing', 'laozhou'],
    },
  ],
};

test('parseActorEditor accurately extracts the 5 form sections', () => {
  const actor = (mockDraftContent.actors as Record<string, unknown>[])[0]!;
  const form = parseActorEditor(actor, mockDraftContent);

  // Section 1: 名字与身份
  assert.equal(form.name, '青青');
  assert.equal(form.key, 'qingqing');
  assert.equal(form.identity, '诊所助手');
  assert.equal(form.appearance, '身穿浅白大褂，长发挽起，眼神清澈而冷静。');
  assert.deepEqual(form.traits, ['细心', '清冷', '敏锐']);
  assert.equal(form.avatarMediaKey, 'media_qingqing_01');

  // Section 2: 与主角初始关系
  assert.equal(form.relationshipToPlayer, '青梅竹马 / 邻居');

  // Section 3: 性格与说话方式
  assert.equal(form.voice, '说话简洁轻柔，习惯用陈述句，情绪很少外露。');
  assert.equal(form.background, '本地人，祖父曾是老周的合伙医生。');

  // Section 4: 她想要什么 (在乎 / 眼前)
  assert.equal(form.caresAbout, '诊所的平静与祖父留下的医案');
  assert.equal(form.immediateGoal, '查清昨晚私自取药的人是谁');

  // Section 5: 关系与边界 (底线 / 知情)
  assert.equal(form.boundaries, '讨厌别人翻动内室诊柜，反感轻浮的玩笑。');
  assert.deepEqual(form.knownFactKeys, ['fact_clinic_history', 'fact_secret_formula']);
});

test('splitMotivation and joinMotivation handle dual formats and raw text lossless', () => {
  const dual = '在乎：诊所平安\n眼前：解决当前危机';
  const split = splitMotivation(dual);
  assert.equal(split.caresAbout, '诊所平安');
  assert.equal(split.immediateGoal, '解决当前危机');

  const joined = joinMotivation(split.caresAbout, split.immediateGoal);
  assert.equal(joined, dual);

  const rawOnly = '只是想平稳度过这个夏天。';
  const splitRaw = splitMotivation(rawOnly);
  assert.equal(splitRaw.caresAbout, rawOnly);
  assert.equal(splitRaw.immediateGoal, '');
});

test('updateActorInContent preserves immutable actor key and saves unedited fields', () => {
  const actor = (mockDraftContent.actors as Record<string, unknown>[])[0]!;
  const form = parseActorEditor(actor, mockDraftContent);
  form.name = '青青（修改版）';
  form.identity = '主治药剂师';
  form.relationshipToPlayer = '挚友';
  form.caresAbout = '新的在乎事项';

  const updatedContent = updateActorInContent(mockDraftContent, form);
  const updatedActors = updatedContent.actors as Record<string, unknown>[];
  const updatedActor = updatedActors.find((a) => a.key === 'qingqing');

  assert.ok(updatedActor);
  assert.equal(updatedActor?.name, '青青（修改版）');
  assert.equal(updatedActor?.key, 'qingqing'); // Key is immutable
  assert.equal((updatedActor?.publicCard as Record<string, unknown>)?.identity, '主治药剂师');

  // Check relationship updated
  const rels = updatedContent.relationships as Record<string, unknown>[];
  const rel = rels.find((r) => {
    const to = r.to as Record<string, unknown>;
    return to?.kind === 'actor' && to?.actorKey === 'qingqing';
  });
  assert.equal(rel?.description, '挚友');
});

test('generateActorKey produces safe unique keys conforming to /^[a-z][a-z0-9_]{0,31}$/', () => {
  const keys = ['actor_1', 'actor_2', 'qingqing'];
  const newKey1 = generateActorKey(keys, 'actor');
  assert.ok(/^[a-z][a-z0-9_]{0,31}$/.test(newKey1));
  assert.equal(keys.includes(newKey1), false);

  const newKey2 = generateActorKey(keys, '999_custom');
  assert.ok(/^[a-z][a-z0-9_]{0,31}$/.test(newKey2));
  assert.equal(keys.includes(newKey2), false);
});

test('checkActorDeletionSafety flags all references across relationships, messages, invitations, history, candidates', () => {
  // Qingqing is referenced in relationship, messages, invitations, and candidates
  const qingqingSafety = checkActorDeletionSafety(mockDraftContent, 'qingqing');
  assert.equal(qingqingSafety.canDelete, false);
  assert.ok(qingqingSafety.references.some((r) => r.category === 'relationship'));
  assert.ok(qingqingSafety.references.some((r) => r.category === 'message'));
  assert.ok(qingqingSafety.references.some((r) => r.category === 'invitation'));
  assert.ok(qingqingSafety.references.some((r) => r.category === 'candidate'));

  // Laozhou is referenced in relationships, history, and candidates
  const laozhouSafety = checkActorDeletionSafety(mockDraftContent, 'laozhou');
  assert.equal(laozhouSafety.canDelete, false);
  assert.ok(laozhouSafety.references.some((r) => r.category === 'history'));

  // Standalone unreferenced actor is safe to delete
  const standaloneContent = deepClone(mockDraftContent);
  const actors = standaloneContent.actors as Record<string, unknown>[];
  actors.push({
    key: 'visitor',
    name: '路过的游客',
    knownAtStart: false,
  });
  const visitorSafety = checkActorDeletionSafety(standaloneContent, 'visitor');
  assert.equal(visitorSafety.canDelete, true);
  assert.equal(visitorSafety.references.length, 0);

  // Deleting unreferenced actor works cleanly
  const afterDelete = deleteActorFromContent(standaloneContent, 'visitor');
  assert.equal((afterDelete.actors as Record<string, unknown>[]).length, 2);
});

test('parseWorldSettings and updateWorldSettingsInContent preserve original untouched properties', () => {
  const settings = parseWorldSettings(mockDraftContent);
  assert.equal(settings.title, '海边诊所的午后');
  assert.equal(settings.hook, '海风拂过旧街角，秘密与温柔在诊所悄然展开');
  assert.equal(settings.protagonistIdentity, '返乡青年');

  const updatedContent = updateWorldSettingsInContent(mockDraftContent, {
    ...settings,
    title: '更新后的诊所',
    hook: '全新的故事标语',
  });

  const world = updatedContent.world as Record<string, unknown>;
  assert.equal(world.title, '更新后的诊所');
  assert.equal(world.hook, '全新的故事标语');
  assert.equal(world.startPlaceKey, 'clinic_front'); // Preserved
});

test('parsePlotData extracts history events and candidate plot points', () => {
  const plot = parsePlotData(mockDraftContent);
  assert.equal(plot.history.length, 1);
  assert.equal(plot.history[0]?.text, '周记诊所是小镇唯一的全科诊所。');
  assert.equal(plot.candidates.length, 1);
  assert.equal(plot.candidates[0]?.title, '调查药品失窃');
});

test('isDraftDirty detects changes in title and draft content', () => {
  const initial = deepClone(mockDraftContent);
  assert.equal(
    isDraftDirty({ title: '标题', content: initial }, { title: '标题', content: initial }),
    false,
  );
  assert.equal(
    isDraftDirty({ title: '原标题', content: initial }, { title: '新标题', content: initial }),
    true,
  );

  const modified = deepClone(initial);
  (modified.world as Record<string, unknown>).title = '不同的标题';
  assert.equal(
    isDraftDirty({ title: '原标题', content: initial }, { title: '原标题', content: modified }),
    true,
  );
});
