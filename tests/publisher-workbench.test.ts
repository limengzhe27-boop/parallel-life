import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublisherWork, PublisherCheckResult } from '../src/contracts/world-publisher.ts';
import type { PublisherWorkbenchProps } from '../src/contracts/publisher-workbench.ts';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.module.css'))
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default new Proxy({}, {get:(_t,k)=>String(k)})',
      };
    if (url.endsWith('.tsx') && !url.includes('/node_modules/'))
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
          },
        }).outputText,
      };
    return nextLoad(url, context);
  },
});

const { PublisherWorkbench } = await import('../src/features/publisher/publisher-workbench.tsx');

const mockContent: Record<string, unknown> = {
  world: {
    title: '海边诊所的午后',
    hook: '海风拂过旧街角，秘密与温柔在诊所悄然展开',
    description: '主角来到偏远海滨小镇，在周记诊所遇到熟人与新朋友。',
    experienceNote: '重点体验日常互动与隐藏真相。',
    publicSetting: '偏远海边小镇，医疗条件有限但人情味浓厚。',
    tone: '日常、微悬疑、温情',
    startAt: '初夏六月 午后两点',
    startPlaceKey: 'clinic_front',
    protagonistIdentity: '返乡青年',
    protagonistSituation: '刚回到老家准备拜访诊所。',
  },
  actors: [
    {
      key: 'qingqing',
      name: '青青',
      knownAtStart: true,
      publicCard: {
        identity: '诊所助手',
        appearance: '身穿浅白大褂，眼神清澈而冷静。',
        traits: ['细心', '清冷'],
      },
      privatePersona: {
        voice: '说话简洁轻柔，习惯用陈述句。',
        background: '本地人，祖父曾是老周的合伙医生。',
        motivation: '在乎：诊所的平静与祖父留下的医案\n眼前：查清昨晚私自取药的人是谁',
        boundaries: '讨厌别人翻动内室诊柜。',
      },
    },
    {
      key: 'laozhou',
      name: '老周',
      knownAtStart: true,
      publicCard: {
        identity: '诊所执业医生',
        appearance: '五十来岁，戴老花镜。',
        traits: ['随和', '幽默'],
      },
      privatePersona: {
        voice: '温和带点幽默，爱用反问句。',
        background: '行医三十余年，看似随和糊涂。',
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
  ],
  initialKnowledge: [
    {
      actorKey: 'qingqing',
      factKeys: ['fact_clinic_01'],
    },
  ],
  history: [
    {
      key: 'fact_clinic_01',
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
      actorKeys: ['qingqing'],
    },
  ],
};

const mockWorks = [
  {
    id: 'w-101',
    title: '海边诊所的午后',
    draftVersion: 1,
    status: 'draft' as const,
    metadataVersion: 1,
    publicationVersion: null,
    createdAt: '2026-10-10T10:00:00.000Z',
    updatedAt: '2026-10-12T09:00:00.000Z',
  },
  {
    id: 'w-102',
    title: '旧城咖啡馆之夜',
    draftVersion: 3,
    status: 'published' as const,
    metadataVersion: 2,
    publicationVersion: 1,
    createdAt: '2026-10-08T08:00:00.000Z',
    updatedAt: '2026-10-11T12:00:00.000Z',
  },
];

const mockWork: PublisherWork = {
  id: 'w-101',
  title: '海边诊所的午后',
  draftVersion: 1,
  status: 'draft',
  metadataVersion: 1,
  publicationVersion: null,
  createdAt: '2026-10-10T10:00:00.000Z',
  updatedAt: '2026-10-12T09:00:00.000Z',
  draft: {
    version: 1,
    contentHash: 'content-hash-001',
    content: mockContent,
    createdAt: '2026-10-10T10:00:00.000Z',
    createdBy: 'u-101',
  },
};

const defaultProps: PublisherWorkbenchProps = {
  session: {
    displayName: '编剧小林',
    canEdit: true,
    canPublish: true,
  },
  works: mockWorks,
  work: mockWork,
  check: null,
  busy: false,
  error: null,
  onSelectWork: () => {},
  onCreateWork: () => {},
  onSaveDraft: () => {},
  onCheck: () => {},
  onTrial: () => {},
  onPublish: () => {},
  onLogout: () => {},
};

test('PublisherWorkbench renders complete light-theme 3-column UI', () => {
  const html = renderToStaticMarkup(createElement(PublisherWorkbench, defaultProps));

  // Sidebar works list and create button
  assert.ok(html.includes('海边诊所的午后'));
  assert.ok(html.includes('旧城咖啡馆之夜'));
  assert.ok(html.includes('+ 新建世界'));

  // Header operations
  assert.ok(html.includes('保存草稿'));
  assert.ok(html.includes('检查'));
  assert.ok(html.includes('试演'));
  assert.ok(html.includes('发布'));

  // Navigation tabs
  assert.ok(html.includes('世界设定'));
  assert.ok(html.includes('人物'));
  assert.ok(html.includes('人物 · 2'));
  assert.ok(html.includes('剧情'));

  // Character list and 5-section form
  assert.ok(html.includes('青青'));
  assert.ok(html.includes('诊所助手'));
  assert.ok(html.includes('1. 名字与身份'));
  assert.ok(html.includes('2. 与主角的初始关系'));
  assert.ok(html.includes('3. 性格与说话方式'));
  assert.ok(html.includes('4. 在乎什么、眼前想法'));
  assert.ok(html.includes('5. 关系、知情范围与底线'));

  // Populated character details
  assert.ok(html.includes('青梅竹马 / 邻居'));
  assert.ok(html.includes('说话简洁轻柔，习惯用陈述句。'));
  assert.ok(html.includes('诊所的平静与祖父留下的医案'));
  assert.ok(html.includes('查清昨晚私自取药的人是谁'));
  assert.ok(html.includes('讨厌别人翻动内室诊柜。'));
});

test('PublisherWorkbench honestly indicates unhooked callbacks when onTrial or onPublish omitted', () => {
  const unhookedProps: PublisherWorkbenchProps = {
    ...defaultProps,
    onTrial: undefined,
    onPublish: undefined,
  };
  const html = renderToStaticMarkup(createElement(PublisherWorkbench, unhookedProps));

  assert.ok(html.includes('title="试演功能待后端接口接通"'));
  assert.ok(html.includes('title="发布功能待后端接口接通"'));
});

test('PublisherWorkbench disables edit controls when session.canEdit is false', () => {
  const readOnlyProps: PublisherWorkbenchProps = {
    ...defaultProps,
    session: {
      displayName: '只读访客',
      canEdit: false,
      canPublish: false,
    },
  };
  const html = renderToStaticMarkup(createElement(PublisherWorkbench, readOnlyProps));

  assert.ok(html.includes('您没有编辑权限'));
  assert.ok(html.includes('disabled=""'));
});

test('PublisherWorkbench displays check failure issues accurately', () => {
  const checkResult: PublisherCheckResult = {
    id: 'chk-01',
    workId: 'w-101',
    draftVersion: 1,
    contentHash: 'hash-001',
    status: 'invalid',
    issuesTruncated: false,
    issues: [
      {
        path: ['actors', 0, 'name'],
        code: 'name_required',
      },
    ],
    missingCapabilities: ['model_budget_unapproved'],
    mediaVerified: false,
    trialVerified: false,
    checkedAt: '2026-10-12T10:00:00.000Z',
  };

  const html = renderToStaticMarkup(
    createElement(PublisherWorkbench, {
      ...defaultProps,
      check: checkResult,
    }),
  );

  assert.ok(html.includes('检查未通过'));
  assert.ok(html.includes('actors.0.name: name_required'));
  assert.ok(html.includes('model_budget_unapproved'));
});
