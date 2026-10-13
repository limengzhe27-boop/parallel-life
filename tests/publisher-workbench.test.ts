import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublisherWork, PublisherCheckResult } from '../src/contracts/world-publisher.ts';
import type { PublisherWorkbenchProps } from '../src/contracts/publisher-workbench.ts';

let scheduleForTest: (
  content: Record<string, unknown>,
  options: { referenceAt: string },
) => unknown = () => {
  throw Error('test planner not configured');
};
Object.assign(globalThis, {
  __writerSchedule: (content: Record<string, unknown>, options: { referenceAt: string }) =>
    scheduleForTest(content, options),
});
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('/publication-scheduling.ts'))
      return { url: 'writer-test:scheduling', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'writer-test:scheduling')
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export const planPublicationTimes=(c,o)=>globalThis.__writerSchedule(c,o)',
      };
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
        source: ts.transpileModule(
          url.endsWith('publisher-workbench.tsx')
            ? readFileSync(new URL(url), 'utf8').replace(
                "import React, { useState, useEffect, useMemo, useCallback } from 'react';",
                "import React, { useState as actualUseState, useEffect as actualUseEffect, useMemo as actualUseMemo, useCallback as actualUseCallback } from 'react'; const useState = initial => globalThis.__writerHooks ? globalThis.__writerHooks.useState(initial) : actualUseState(initial === 'settings' && globalThis.__writerTestTab ? globalThis.__writerTestTab : initial); const useMemo = (f,d) => globalThis.__writerHooks ? f() : actualUseMemo(f,d); const useCallback = (f,d) => globalThis.__writerHooks ? f : actualUseCallback(f,d); const useEffect = (f,d) => globalThis.__writerHooks ? undefined : actualUseEffect(f,d);",
              )
            : readFileSync(new URL(url), 'utf8'),
          {
            compilerOptions: {
              target: ts.ScriptTarget.ES2022,
              module: ts.ModuleKind.ESNext,
              jsx: ts.JsxEmit.ReactJSX,
            },
          },
        ).outputText,
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

function renderTab(props: PublisherWorkbenchProps, tab: 'settings' | 'actors' | 'plot' | 'review') {
  Object.assign(globalThis, { __writerTestTab: tab });
  try {
    return renderToStaticMarkup(createElement(PublisherWorkbench, props));
  } finally {
    Reflect.deleteProperty(globalThis, '__writerTestTab');
  }
}
test('workbench defaults to actual story overview with four writer-facing entries and folded business editing', () => {
  const html = renderToStaticMarkup(createElement(PublisherWorkbench, defaultProps));
  for (const text of [
    '海边诊所的午后',
    '旧城咖啡馆之夜',
    '+ 新建世界',
    '保存草稿',
    '检查',
    '试演',
    '发布',
    '故事概览',
    '人物',
    '剧情发展',
    '待确认问题',
    '当前草稿故事概览',
    '青青',
    '青梅竹马 / 邻居',
  ])
    assert.ok(html.includes(text), text);
  assert.match(html, /<details class="settingsDisclosure" id="writer-story-editor">/);
  assert.match(html, /尚未检查草稿/);
  assert.doesNotMatch(html, /人物 · 2|将填入的实际内容/);
});
test('character form preserves all five existing authoring sections and real values after navigation', () => {
  const html = renderTab(defaultProps, 'actors');
  for (const text of [
    '人物 · 2',
    '1. 名字与身份',
    '2. 与主角的初始关系',
    '3. 性格与说话方式',
    '4. 在乎什么、眼前想法',
    '5. 关系、知情范围与底线',
    '诊所助手',
    '青梅竹马 / 邻居',
    '说话简洁轻柔',
    '讨厌别人翻动内室诊柜',
  ])
    assert.ok(html.includes(text), text);
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

  const html = renderTab({ ...defaultProps, check: checkResult }, 'review');

  assert.ok(html.includes('待确认问题'));
  assert.ok(html.includes('人物第 1 项 · 姓名或地点名称'));
  assert.ok(html.includes('部分内容暂时不支持运行'));
  assert.ok(!html.includes('actors.0.name: name_required'));
  assert.ok(html.includes('真实模型调用预算尚未确认'));
  assert.doesNotMatch(html, /限制详情|model_budget_unapproved/);
});

test('character knowledge includes an editable shared fact with a separate knowledge checkbox', () => {
  const html = renderTab(defaultProps, 'actors');
  assert.ok(html.includes('不是固定示例'));
  assert.ok(html.includes('修改这条事实'));
  assert.ok(html.includes('到剧情页管理或新增事实'));
  assert.match(
    html,
    /<textarea[^>]*id="actor-fact-0-fact_clinic_01"[^>]*>周记诊所是小镇唯一的全科诊所。<\/textarea>/,
  );
  assert.ok(html.includes('勾选保持不变'));
});

test('shared fact editor remains disabled while busy or without edit permission', () => {
  for (const extra of [{ busy: true }, { session: { ...defaultProps.session, canEdit: false } }]) {
    const html = renderTab({ ...defaultProps, ...extra }, 'actors');
    assert.match(html, /<textarea[^>]*id="actor-fact-0-fact_clinic_01"[^>]*disabled=""/);
  }
});

test('ambiguous duplicate fact keys do not expose an unsafe inline editor', () => {
  const content = structuredClone(mockContent);
  content.history = [...(content.history as unknown[]), ...(content.history as unknown[])];
  const html = renderTab(
    { ...defaultProps, work: { ...mockWork, draft: { ...mockWork.draft, content } } },
    'actors',
  );
  assert.ok(html.includes('这条事实尚不能安全修改'));
  assert.ok(!html.includes('id="actor-fact-'));
});

const readyCheck: PublisherCheckResult = {
  id: 'check-ready',
  workId: mockWork.id,
  draftVersion: mockWork.draftVersion,
  contentHash: mockWork.draft.contentHash,
  status: 'ready',
  issuesTruncated: false,
  issues: [],
  missingCapabilities: [],
  mediaVerified: true,
  trialVerified: true,
  checkedAt: '2026-10-13T00:00:00Z',
};
test('all returned issues and run restrictions are available, with server truncation explicitly retained', () => {
  const check: PublisherCheckResult = {
    ...readyCheck,
    status: 'invalid',
    issuesTruncated: true,
    issues: Array.from({ length: 8 }, (_, i) => ({
      path: ['actors', i, 'name'],
      code: 'name_required',
    })),
    missingCapabilities: ['model_budget_unapproved', 'unrecognized_runtime_feature'],
    mediaVerified: false,
    trialVerified: false,
  };
  const html = renderTab({ ...defaultProps, check }, 'review');
  for (let i = 1; i <= 8; i++) assert.ok(html.includes(`人物第 ${i} 项`));
  assert.match(html, /待确认问题：.*12 项/);
  assert.match(html, /仍有未列出的项/);
  assert.match(html, /尚未完成真实试演|素材尚未核验/);
  assert.doesNotMatch(html, /unrecognized_runtime_feature/);
  assert.match(html, /这项内容暂不支持运行/);
  assert.doesNotMatch(html, /…还有/);
});
test('a ready check for an old hash never labels the current draft publishable', () => {
  const html = renderTab(
    { ...defaultProps, check: { ...readyCheck, contentHash: 'old-hash' } },
    'review',
  );
  assert.match(html, /旧稿或其他版本/);
  assert.doesNotMatch(html, /当前已保存稿的检查通过/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>发布<\/button>/);
});
test('existing permission, version, hash, trial and media publication guards stay enforced', () => {
  const allowed = renderTab({ ...defaultProps, check: readyCheck }, 'review');
  assert.match(allowed, /<button(?![^>]*disabled)[^>]*>发布<\/button>/);
  for (const patch of [
    { workId: 'other-work' },
    { draftVersion: 2 },
    { contentHash: 'other-hash' },
    { trialVerified: false },
    { mediaVerified: false },
    { status: 'blocked' as const },
  ]) {
    const html = renderTab({ ...defaultProps, check: { ...readyCheck, ...patch } }, 'review');
    assert.match(html, /<button[^>]*disabled=""[^>]*>发布<\/button>/);
  }
  const readOnly = renderTab(
    { ...defaultProps, check: readyCheck, session: { ...defaultProps.session, canPublish: false } },
    'review',
  );
  assert.match(readOnly, /<button[^>]*disabled=""[^>]*>发布<\/button>/);
});
test('missing or unrecognized start date stays explicitly actionable outside folded settings', () => {
  for (const startAt of ['', '初夏午后']) {
    const content = {
      ...mockContent,
      world: { ...(mockContent.world as Record<string, unknown>), startAt },
    };
    const html = renderTab(
      { ...defaultProps, work: { ...mockWork, draft: { ...mockWork.draft, content } } },
      'settings',
    );
    assert.match(html, /开场时间尚未安排或需核对/);
    assert.match(html, /查看时间设置/);
    assert.match(html, /精确开场日期和时间/);
    assert.match(html, /<details class="timeDisclosure">/);
  }
});

test('an empty new story visibly opens editing without automatically saving', () => {
  let saved = 0;
  const content = { work: { title: '新故事' }, world: { startAt: '' } };
  const html = renderToStaticMarkup(
    createElement(PublisherWorkbench, {
      ...defaultProps,
      onSaveDraft: () => {
        saved++;
      },
      work: { ...mockWork, draft: { ...mockWork.draft, content } },
    }),
  );
  assert.match(html, /<details class="settingsDisclosure" id="writer-story-editor" open="">/);
  assert.match(html, /先在下方填写故事介绍/);
  assert.match(html, /id="work-title-input"/);
  assert.equal(saved, 0);
});
test('applying import from character or plot returns to overview, closes import and never auto-saves', async () => {
  const { PublisherImportDialog } =
    await import('../src/features/publisher/publisher-import-dialog.tsx');
  const { PublisherReviewView } =
    await import('../src/features/publisher/publisher-review-view.ts');
  function nodes(value: unknown): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!isValidElement(value)) return [];
    const e = value as ReactElement<Record<string, unknown>>;
    return [e, ...nodes(e.props.children)];
  }
  for (const [initial, keepOpen] of [
    ['actors', false],
    ['plot', false],
    ['actors', true],
  ] as const) {
    let cursor = 0,
      saved = 0;
    const states: unknown[] = [initial];
    Object.assign(globalThis, {
      __writerHooks: {
        useState: (v: unknown) => {
          const i = cursor++;
          if (!(i in states)) states[i] = typeof v === 'function' ? v() : v;
          return [
            states[i],
            (next: unknown) => {
              states[i] = typeof next === 'function' ? next(states[i]) : next;
            },
          ];
        },
      },
    });
    try {
      const render = () => {
        cursor = 0;
        return PublisherWorkbench({
          ...defaultProps,
          onSaveDraft: () => {
            saved++;
          },
        });
      };
      let tree = render();
      const button = nodes(tree).find(
        (e) => e.type === 'button' && e.props.children === '导入 Markdown',
      );
      assert.ok(button);
      (button.props.onClick as () => void)();
      tree = render();
      const dialog = nodes(tree).find((e) => e.type === PublisherImportDialog);
      assert.ok(dialog);
      const next = {
        work: { title: '整理后的标题', description: '完整故事介绍' },
        world: { publicSetting: '新的舞台' },
        extensions: [{ unchanged: '作者扩展' }],
      };
      (dialog.props.onApply as (v: unknown, s: unknown, options?: { keepOpen?: boolean }) => void)(
        next,
        {
          actors: [],
          initialMessagesCount: 0,
          candidatesCount: 0,
          warnings: [],
          diagnostics: [],
          unmapped: [],
        },
        { keepOpen },
      );
      tree = render();
      assert.equal(states[0], 'settings');
      assert.equal(saved, 0);
      assert.equal(
        nodes(tree).some((e) => e.type === PublisherImportDialog),
        keepOpen,
      );
      assert.equal(nodes(tree).find((e) => e.type === PublisherReviewView)!.props.content, next);
    } finally {
      Reflect.deleteProperty(globalThis, '__writerHooks');
    }
  }
});

test('manual scheduling uses work creation time, adopts only successful plans, and never saves or trials', async () => {
  const { PublisherScheduleReview } =
    await import('../src/features/publisher/publisher-schedule-review.tsx');
  const { PublisherImportDialog } =
    await import('../src/features/publisher/publisher-import-dialog.tsx');
  function nodes(value: unknown): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!isValidElement(value)) return [];
    const e = value as ReactElement<Record<string, unknown>>;
    return [e, ...nodes(e.props.children)];
  }
  for (const status of ['proposed', 'unchanged', 'blocked'] as const) {
    let cursor = 0,
      calls = 0,
      saved = 0,
      trials = 0;
    const states: unknown[] = [];
    const source = {
      work: { title: '手工故事' },
      world: { startAt: '' },
      extensions: [{ opaque: '作者内容' }],
    };
    const next = { ...source, world: { startAt: mockWork.createdAt } };
    Object.assign(globalThis, {
      __writerHooks: {
        useState: (v: unknown) => {
          const i = cursor++;
          if (!(i in states)) states[i] = typeof v === 'function' ? v() : v;
          return [
            states[i],
            (n: unknown) => {
              states[i] = typeof n === 'function' ? n(states[i]) : n;
            },
          ];
        },
      },
    });
    scheduleForTest = (content, options) => {
      calls++;
      assert.deepEqual(content, source);
      assert.equal(options.referenceAt, mockWork.createdAt);
      return {
        status,
        updatedContent: next,
        changes:
          status === 'proposed'
            ? [{ path: ['world', 'startAt'], value: mockWork.createdAt, reason: 'default_start' }]
            : [],
        issues:
          status === 'blocked'
            ? [{ path: ['world', 'startAt'], code: 'scheduling_no_feasible_start' }]
            : [],
      };
    };
    const props = {
      ...defaultProps,
      work: { ...mockWork, draft: { ...mockWork.draft, content: source } },
      onSaveDraft: () => {
        saved++;
      },
      onTrial: () => {
        trials++;
      },
    };
    const render = () => {
      cursor = 0;
      return PublisherWorkbench(props);
    };
    try {
      let tree = render();
      assert.equal(calls, 0);
      const action = nodes(tree).find(
        (e) => e.type === 'button' && e.props.children === '安排缺省时间',
      );
      assert.ok(action);
      (action.props.onClick as () => void)();
      tree = render();
      const view = nodes(tree).find((e) => e.type === PublisherScheduleReview);
      assert.ok(view);
      assert.deepEqual(view.props.content, status === 'proposed' ? next : source);
      assert.equal(calls, 1);
      assert.equal(saved, 0);
      assert.equal(trials, 0);
      const field = nodes(tree).find((e) => e.props.id === 'world-tone-input');
      assert.ok(field);
      (field.props.onChange as (e: unknown) => void)({ target: { value: '新的氛围' } });
      tree = render();
      assert.ok(!nodes(tree).some((e) => e.type === PublisherScheduleReview));
      const importButton = nodes(tree).find(
        (e) => e.type === 'button' && e.props.children === '导入 Markdown',
      )!;
      (importButton.props.onClick as () => void)();
      assert.equal(
        nodes(render()).find((e) => e.type === PublisherImportDialog)!.props.referenceAt,
        mockWork.createdAt,
      );
    } finally {
      Reflect.deleteProperty(globalThis, '__writerHooks');
    }
  }
});
test('manual scheduling cannot execute with edit permission missing or while busy', () => {
  function nodes(value: unknown): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!isValidElement(value)) return [];
    const e = value as ReactElement<Record<string, unknown>>;
    return [e, ...nodes(e.props.children)];
  }
  let calls = 0;
  scheduleForTest = () => {
    calls++;
    throw Error('must not run');
  };
  for (const patch of [{ busy: true }, { session: { ...defaultProps.session, canEdit: false } }]) {
    let cursor = 0;
    const states: unknown[] = [];
    Object.assign(globalThis, {
      __writerHooks: {
        useState: (v: unknown) => {
          const i = cursor++;
          if (!(i in states)) states[i] = typeof v === 'function' ? v() : v;
          return [states[i], () => {}];
        },
      },
    });
    try {
      const tree = PublisherWorkbench({ ...defaultProps, ...patch });
      const action = nodes(tree).find(
        (e) => e.type === 'button' && e.props.children === '安排缺省时间',
      )!;
      assert.equal(action.props.disabled, true);
      (action.props.onClick as () => void)();
    } finally {
      Reflect.deleteProperty(globalThis, '__writerHooks');
    }
  }
  assert.equal(calls, 0);
});

test('author settings retain optional old descriptions but remove raw-data editing and technical disclosures', () => {
  const html = renderTab(defaultProps, 'settings');
  assert.doesNotMatch(
    html,
    /完整内容（JSON）|导入完整结构化草稿|publication-import|技术详情|高级：版本/,
  );
  assert.match(html, /另写作品展示简介（选填）/);
  assert.match(html, /故事介绍（玩家可知）/);
  const actor = renderTab(defaultProps, 'actors');
  assert.doesNotMatch(actor, /稳定标识|内部标识/);
});
