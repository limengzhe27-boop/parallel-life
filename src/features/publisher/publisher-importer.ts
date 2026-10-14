/**
 * Pure domain parser for Feishu Markdown script files.
 * Extracts World Settings, Character 5-section forms (L1-L5), and Plot nodes.
 * Completely deterministic, zero external network or model dependencies.
 */

import type { PublisherSchedule } from '../../contracts/publisher-preparation.ts';
import { planPublicationTimes } from '../../modules/settings/domain/publication-scheduling.ts';
import { PublishedWorldContentSchema } from '../../contracts/published-world-content.ts';
import {
  publicationStorageIssues,
  PUBLICATION_LIFE_MODULE_MAX_CHARS,
} from '../../modules/settings/domain/publication-content.ts';
import {
  generateActorKey,
  joinMotivation,
  type ActorEditorForm,
  type WorldSettingsForm,
} from './publisher-editor.ts';
import { importLifeModules, type ImportedLifeModules } from './publisher-life-modules-import.ts';

export type ImportedActor = {
  form: ActorEditorForm;
  lifeModules?: ImportedLifeModules;
  introduction?: string;
  diagnostics?: string[];
  sourceFilename?: string;
};

export type ImportedWorld = {
  startAt?: string;
  settings: Partial<WorldSettingsForm>;
  sourceFilename?: string;
};

export type ImportedPlot = {
  initialMessages: Array<{
    actorName: string;
    text: string;
    at?: string;
    origin?: 'history' | 'incoming';
  }>;
  candidates: Array<{ title: string; actorNames: string[]; editorialIntent: string }>;
  sourceFilename?: string;
};

export type ImportSummary = {
  world?: { title: string; hook: string; protagonistIdentity: string };
  actors: Array<{
    name: string;
    key: string;
    identity: string;
    relationshipToPlayer?: string;
    caresAbout?: string;
    sectionsCount: number;
    completeness: 'partial' | 'complete';
  }>;
  initialMessagesCount: number;
  candidatesCount: number;
  warnings: string[];
  diagnostics: Array<{
    code: string;
    severity: 'warning' | 'error';
    filename: string;
    path?: string;
    message: string;
  }>;
  unmapped: Array<{ filename: string; reason: string; content: string }>;
  blocked: boolean;
};

export { extractZipEntries } from './publisher-zip.ts';

/**
 * Splits a document that contains multiple character headings into individual chunks.
 */
export function splitMultiActorMarkdown(content: string): string[] {
  const headings = [
    ...content.matchAll(
      /^(#{1,6})\s*((?:人物|角色)[0-9一二三四五六七八九十]*)\s*[:：]\s*([^\r\n#|]+)/gm,
    ),
  ];
  if (!headings.length) return [content];
  const level = headings[0]![1]!.length;
  const top = headings.filter((h) => h[1]!.length === level);
  const identities = new Set(top.map((h) => h[2]!.trim() + ':' + h[3]!.trim()));
  // A single labelled person may have an earlier L1-L5 table and a later repeated profile.
  if (identities.size <= 1) return [content];
  return top.map((h, i) =>
    content.slice(i === 0 ? 0 : h.index!, top[i + 1]?.index ?? content.length),
  );
}

/**
 * Extracts clean plain text from Markdown, removing markdown bold, links, and HTML tags.
 */
function cleanMdText(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Extracts section text under a specific markdown heading (e.g. # 基础设定, ## 画像).
 */
function extractHeadingSection(content: string, headingRegex: RegExp): string {
  const lines = content.split(/\r?\n/);
  let matched = false;
  const captured: string[] = [];

  for (const line of lines) {
    if (headingRegex.test(line)) {
      matched = true;
      continue;
    }
    if (matched) {
      // Stop if encountered another top-level heading
      if (/^#{1,2}\s+/.test(line)) {
        break;
      }
      captured.push(line);
    }
  }
  return captured.join('\n').trim();
}

/**
 * Extracts key-value pair from text like "年龄：21岁" or "身份：男主青梅".
 */
function extractField(text: string, keys: string[]): string {
  for (const key of keys) {
    const regex = new RegExp(`(?:${key})[：:]\\s*([^\\r\\n]+)`, 'i');
    const match = text.match(regex);
    if (match && match[1]) {
      return cleanMdText(match[1]);
    }
  }
  return '';
}

/**
 * Parses an Actor markdown document (e.g., 人物1_青青.md).
 * Accurately extracts L1~L5 table cells or unstructured text into ActorEditorForm.
 */
export function parseFeishuActorMarkdown(
  content: string,
  existingKeys: string[] = [],
  filename = '',
): ImportedActor {
  // 1. Extract Character Name
  let name = '';
  const titleMatch = content.match(
    /^#+\s*(?:人物|角色|任务)\s*[0-9一二三四五六七八九十]*\s*[:：]\s*([^\r\n#|]+)/m,
  );
  if (titleMatch && titleMatch[1]) {
    name = cleanMdText(titleMatch[1]);
  } else {
    // Try filename fallback (e.g. 人物1_青青.md or 任务一_青青.md -> 青青)
    const fileMatch = filename.match(
      /(?:人物|角色|任务)\s*[0-9一二三四五六七八九十]*[_—\s-]*([^.\r\n]+)/,
    );
    if (fileMatch && fileMatch[1]) {
      name = fileMatch[1].trim();
    } else {
      const heading1 = content.match(/^#+\s+([^\r\n#|]+)/m);
      if (
        heading1 &&
        heading1[1] &&
        !/^(基础设定|性格设定|背景|世界观|任务节点|开场事件|人物合集|人生背景|人格特质|动机与价值观|行为模式|关系模型|角色介绍|公开介绍|给玩家的介绍|给用户的介绍|L[1-5]\b|Life Context\b|Traits\b|Drives\b|Behavior(?:al)?\b|Relationships?\b)/i.test(
          cleanMdText(heading1[1]),
        )
      ) {
        name = cleanMdText(heading1[1]);
      }
      if (!name) name = extractField(content, ['姓名', '名字']);
    }
  }
  name =
    name.replace(/^(?:人物|角色|任务)\s*[0-9一二三四五六七八九十]*[:：]/, '').trim() ||
    '未命名角色';

  // 2. Generate Safe Key (e.g. actor_qingqing or actor_1)
  const safePrefix = name.toLowerCase().replace(/[^a-z0-9_]/g, '') || 'actor';
  const key = generateActorKey(existingKeys, safePrefix.length > 2 ? `a_${safePrefix}` : 'actor');

  // Keep each authored module whole; bounded legacy fields remain compatible projections.
  const imported = importLifeModules(content);
  const l1Content = imported.modules.lifeContext ?? '';
  const l2Content = imported.modules.traits ?? '';
  const l3Content = imported.modules.drives ?? '';
  const l4Content = imported.modules.behavior ?? '';
  const l5Content = imported.modules.relationships ?? '';

  // 4. Fallback to freeform headings if table rows are not populated
  const baseSection = extractHeadingSection(content, /^#+\s*基础设定/);
  const personalitySection = extractHeadingSection(content, /^#+\s*性格设定/);

  // Section 1: 名字与身份 (Identity, Age, Appearance)
  const age = extractField(l1Content || baseSection, ['年龄']);
  const identityRole = extractField(l1Content || baseSection, ['身份', '职业']);
  const identity = [age, identityRole].filter(Boolean).join(' · ') || identityRole || age || '';

  let appearance = extractField(l1Content || baseSection, ['外貌信息', '外貌', '画像']);
  if (!appearance && (l1Content || baseSection).includes('外貌')) {
    const appearMatch = (l1Content || baseSection).match(
      /外貌[^\n]*\n([\s\S]*?)(?=\n[^\n]+[：:]|$)/,
    );
    if (appearMatch && appearMatch[1]) {
      appearance = cleanMdText(appearMatch[1]).split('\n')[0] ?? '';
    }
  }

  // Section 2: 与主角初始关系
  let relationshipToPlayer = extractField(l5Content, [
    '与用户（主角）',
    '与用户',
    '与主角',
    '与男主',
  ]);
  if (!relationshipToPlayer && l5Content) {
    // Look for first sentence or paragraph in L5
    relationshipToPlayer = l5Content.split('\n')[0] ?? '';
  }
  if (!relationshipToPlayer && identityRole.includes('青梅')) {
    relationshipToPlayer = identityRole;
  }

  // Section 3: 性格与说话方式
  let voice = '';
  const parsedTraits: string[] = [];
  if (l2Content) {
    // Extract reply mechanism and character traits
    const replyMechanism = extractField(l2Content, ['回复机制', '机制']);
    const traitLines = l2Content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^[一二三四五六七八九十0-9]、/.test(l));

    for (const tLine of traitLines) {
      const keyword = tLine
        .replace(/^[一二三四五六七八九十0-9]、\s*/, '')
        .split(/[：:，,。\s]/)[0]
        ?.trim();
      if (keyword && keyword.length <= 10 && !parsedTraits.includes(keyword)) {
        parsedTraits.push(keyword);
      }
    }

    const traitsText = traitLines.join('；');
    voice = [traitsText, replyMechanism ? `回复机制：${replyMechanism}` : '']
      .filter(Boolean)
      .join('\n');
  }
  if (!voice && personalitySection) {
    voice = personalitySection;
  }

  // Detailed background (小学/初中/高中/大学经历)
  const background = l1Content || baseSection;

  // Section 4: 在乎什么、眼前想法
  let caresAbout = extractField(l3Content, ['核心欲望', '欲望', '在乎']);
  if (!caresAbout && l3Content) {
    const lines = l3Content.split('\n').filter(Boolean);
    caresAbout = lines[0] ?? '';
  }

  let immediateGoal = extractField(l3Content, ['追求目标', '目标', '眼前想法', '眼前']);
  if (!immediateGoal && l5Content) {
    const goalMatch = l5Content.match(/当前节点[^\n]*[：:]\s*([^\n]+)/);
    if (goalMatch && goalMatch[1]) {
      immediateGoal = cleanMdText(goalMatch[1]);
    }
  }

  const rawMotivation = joinMotivation(caresAbout, immediateGoal);

  // Section 5: 关系、知情范围与底线
  let boundaries = extractField(l4Content, ['底线', '禁忌', '处世姿态', '面对回避']);
  if (!boundaries && l4Content) {
    const bLines = l4Content.split('\n').filter((l) => l.includes('不') || l.includes('忌'));
    boundaries = bLines.slice(0, 2).join('；');
  }

  if (!voice) voice = l2Content;
  if (!boundaries) boundaries = l4Content;
  const form: ActorEditorForm = {
    key,
    name,
    identity,
    appearance,
    traits: parsedTraits,
    avatarMediaKey: undefined,
    knownAtStart: /^(是|true)$/i.test(extractField(content, ['开场已认识', '开场认识'])),
    relationshipToPlayer,
    voice,
    background,
    caresAbout,
    immediateGoal,
    rawMotivation,
    boundaries,
    knownFactKeys: [],
  };

  return {
    form,
    ...(Object.keys(imported.modules).length ? { lifeModules: imported.modules } : {}),
    ...(imported.introduction ? { introduction: imported.introduction } : {}),
    ...(imported.diagnostics.length ? { diagnostics: imported.diagnostics } : {}),
    sourceFilename: filename,
  };
}

/**
 * Parses a World Settings markdown document (e.g. 世界观1_渣男体验.md).
 */
export function parseFeishuWorldMarkdown(content: string, filename = ''): ImportedWorld {
  const settings: Partial<WorldSettingsForm> = {};
  const title = content.match(/^#\s*世界观\s*\d*\s*[:：]\s*([^\r\n#|]+)/m);
  settings.title = cleanMdText(title?.[1] ?? extractField(content, ['标题']));
  const explicit = (label: string) =>
    extractHeadingSection(content, new RegExp(String.raw`^#+\s*${label}\s*$`)) ||
    extractField(content, [label]);
  settings.description = explicit('公开简介');
  settings.hook = explicit('开场钩子');
  settings.publicSetting = explicit('公开设定');
  settings.hiddenContext = extractHeadingSection(content, /^#+\s*世界观梗概/);
  settings.protagonistIdentity = extractField(content, ['主角身份', '用户的角色身份']);
  return {
    settings,
    sourceFilename: filename,
    startAt: extractField(content, ['开场时间', '开始时间', 'startAt']) || undefined,
  };
}

export function parseFeishuPlotMarkdown(content: string, filename = ''): ImportedPlot {
  const initialMessages: ImportedPlot['initialMessages'] = [];
  const candidates: ImportedPlot['candidates'] = [];
  const opening = extractHeadingSection(content, /^#+\s*开场事件\s*$/);
  // The complete block remains in the review proposal; metadata is never invented.
  const messages = /\*\*([^*\r\n]+)[：:]\*\*\s*\n([\s\S]*?)(?=\n\*\*[^*]+[：:]\*\*|$)/g;
  let m: RegExpExecArray | null;
  while ((m = messages.exec(opening))) {
    const block = m[2]!;
    const text = block
      .split(/\r?\n/)
      .filter((l) => /^>\s?/.test(l))
      .map((l) => l.replace(/^>\s?/, ''))
      .join('\n');
    const at = extractField(block, ['时间', 'at']);
    const origin = extractField(block, ['来源', 'origin']);
    if (text)
      initialMessages.push({
        actorName: m[1]!.trim(),
        text,
        ...(at ? { at } : {}),
        ...(origin === 'history' || origin === 'incoming' ? { origin } : {}),
      });
  }
  const headings = [...content.matchAll(/^##\s*[（(][^）)]+[）)]\s*([^\r\n]+)/gm)];
  const instructionTitles = new Set([
    '导入后还要补全',
    '导入说明',
    '使用说明',
    '导入注意事项',
    '填写说明',
  ]);
  const instructions = [...content.matchAll(/^#{1,6}\s+([^\r\n]+)/gm)].filter((h) =>
    instructionTitles.has(cleanMdText(h[1]!)),
  );
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]!;
    let end = headings[i + 1]?.index ?? content.length;
    const instruction = instructions.find((h) => h.index! > heading.index! && h.index! < end);
    if (instruction) end = instruction.index!;
    const body = content.slice(heading.index!, end).trim();
    candidates.push({ title: heading[1]!.trim(), actorNames: [], editorialIntent: body });
  }
  return { initialMessages, candidates, sourceFilename: filename };
}

function explicitPlayerRelationship(content: string): string {
  const raw = importLifeModules(content).modules.relationships ?? '';
  const field = /(?:^|\n)\s*(?:与主角|与玩家|与用户（主角）|与用户\(主角\))[：:]\s*([^\r\n]+)/.exec(
    raw,
  );
  return field?.[1]?.trim() ?? '';
}

/**
 * Bundles multiple imported markdown files (or single merged file) into a full Publisher draft state.
 */
export function parseFeishuMarkdownBundle(
  files: Array<{ filename: string; content: string }>,
  currentContent: Record<string, unknown> = {},
  scheduling?: { referenceAt: string },
): {
  updatedContent: Record<string, unknown>;
  summary: ImportSummary;
  schedule?: PublisherSchedule;
} {
  const summary: ImportSummary = {
    actors: [],
    initialMessagesCount: 0,
    candidatesCount: 0,
    warnings: [],
    diagnostics: [],
    unmapped: [],
    blocked: false,
  };
  const note = (
    code: string,
    filename: string,
    message: string,
    severity: 'warning' | 'error' = 'warning',
    path?: string,
  ) => {
    summary.diagnostics.push({ code, severity, filename, message, ...(path ? { path } : {}) });
    summary.warnings.push(message);
    if (severity === 'error') summary.blocked = true;
  };
  // Validate descriptors before cloning so a caller cannot smuggle getters or prototypes.
  if (publicationStorageIssues(currentContent).length) {
    note('invalid_current_content', '', '当前草稿不是有界 JSON，请先修复草稿。', 'error');
    return { updatedContent: currentContent, summary };
  }
  if (Array.isArray(files) && files.length === 0) {
    note('empty_input', '', '没有可导入的文档，原草稿未修改。', 'error');
    return { updatedContent: currentContent, summary };
  }
  const original = JSON.parse(JSON.stringify(currentContent)) as Record<string, unknown>;
  let copy = JSON.parse(JSON.stringify(original)) as Record<string, any>;
  const baseline = PublishedWorldContentSchema.safeParse(original);
  const pathValue = (path: PropertyKey[]) => {
    let v: unknown = original;
    for (const key of path) {
      if (!v || typeof v !== 'object' || !Object.hasOwn(v, key)) return undefined;
      v = (v as Record<PropertyKey, unknown>)[key];
    }
    return v;
  };
  if (
    Array.isArray(original) ||
    (!baseline.success &&
      baseline.error.issues.some(
        (i) => i.code === 'invalid_type' && pathValue(i.path) !== undefined,
      ))
  ) {
    note(
      'invalid_baseline_shape',
      '',
      '已有草稿字段类型错误，未覆盖或修正原数据，请先人工整理。',
      'error',
    );
    return { updatedContent: original, summary };
  }

  const bytes = (text: string) => new TextEncoder().encode(text).length;
  if (
    !Array.isArray(files) ||
    files.length > 64 ||
    files.some((f) => !f || typeof f.filename !== 'string' || typeof f.content !== 'string')
  ) {
    note('invalid_files', '', '导入最多64份文本文件，文件名与内容必须为文本。', 'error');
    return { updatedContent: original, summary };
  }
  if (files.reduce((sum, f) => sum + bytes(f.filename) + bytes(f.content), 0) > 128 * 1024) {
    note('input_budget', '', '稿件累计超过128KiB，已阻止导入；请拆分文件。原草稿未修改。', 'error');
    return { updatedContent: original, summary };
  }
  const records = (v: unknown): Record<string, any>[] => (Array.isArray(v) ? v : []);
  const actors = records(copy.actors),
    existingNames = new Set(actors.map((a) => a.name));
  const partialActorIndices = new Set<number>();
  const actorKeys = actors.map((a) => String(a.key));
  const namespace = new Set<string>();
  for (const name of [
    'actors',
    'relationships',
    'places',
    'history',
    'candidates',
    'media',
    'extensions',
  ])
    for (const row of records(copy[name])) if (typeof row.key === 'string') namespace.add(row.key);
  for (const name of ['messages', 'notes', 'invitations', 'album'])
    for (const row of records(copy.phone?.[name]))
      if (typeof row.key === 'string') namespace.add(row.key);
  const fresh = (prefix: string) => {
    const k = generateActorKey([...namespace], prefix);
    namespace.add(k);
    return k;
  };
  const object = (name: string) => {
    if (!copy[name] || typeof copy[name] !== 'object' || Array.isArray(copy[name])) copy[name] = {};
    return copy[name] as Record<string, any>;
  };
  const fill = (obj: Record<string, any>, field: string, value: unknown, filename: string) => {
    if (typeof value !== 'string' || !value.trim()) return;
    if (typeof obj[field] === 'string' && obj[field].trim()) {
      note(
        'existing_field_preserved',
        filename,
        `${filename}：已有${field}保留，新内容留在导入报告中。`,
      );
      return;
    }
    const limits: Record<string, number> = {
      title: 80,
      description: 1600,
      hook: 180,
      publicSetting: 1600,
      hiddenContext: 4000,
      identity: 300,
    };
    if (value.length > (limits[field] ?? 4000)) {
      note('field_budget', filename, `${filename}：${field}超出字段长度预算，未截断。`, 'error');
      return;
    }
    obj[field] = value;
  };
  for (const file of files) {
    const { filename, content } = file;
    let recognized = false;
    const actorFilename = /(?:^|[/ >])(?:人物|角色)[0-9一二三四五六七八九十]*[_：: .-]/.test(
      filename,
    );
    const actorHeading = /^#+\s*(?:人物|角色)[0-9一二三四五六七八九十]*\s*[:：]/m.test(content);
    const moduleDocument = importLifeModules(content);
    const hasLifeModules = Object.keys(moduleDocument.modules).length > 0;
    // Retain the whole bounded input only in the front-end review proposal, never extensions/public fields.
    summary.unmapped.push({ filename, reason: 'source_review', content });
    note(
      'source_review',
      filename,
      `${filename}：原文完整保留供核对；仅填写已识别明确字段，不能视为完整可运行稿件。`,
    );
    if (
      /世界观/.test(filename) ||
      /^#+\s*世界观\s*[0-9一二三四五六七八九十]*\s*[:：]/m.test(content) ||
      (!actorFilename &&
        !actorHeading &&
        !hasLifeModules &&
        /^#+\s*(?:世界观|公开简介|开场钩子)/m.test(content))
    ) {
      recognized = true;
      const importedWorld = parseFeishuWorldMarkdown(content, filename);
      const world = importedWorld.settings;
      const work = object('work'),
        setting = object('world'),
        player = object('protagonist');
      fill(work, 'title', world.title, filename);
      fill(work, 'description', world.description, filename);
      fill(work, 'hook', world.hook, filename);
      fill(setting, 'startAt', importedWorld.startAt, filename);
      fill(setting, 'publicSetting', world.publicSetting, filename);
      fill(setting, 'hiddenContext', world.hiddenContext, filename);
      fill(player, 'identity', world.protagonistIdentity, filename);
      summary.world = {
        title: String(work.title ?? ''),
        hook: String(work.hook ?? ''),
        protagonistIdentity: String(player.identity ?? ''),
      };
      note(
        'world_source_review',
        filename,
        `${filename}：只填写明确字段；梗概仅作幕后内容，未映射段落保留供核对。`,
      );
    }
    if (actorFilename || actorHeading || hasLifeModules || /\|\s*(?:\*\*)?L1/.test(content)) {
      recognized = true;
      for (const chunk of splitMultiActorMarkdown(content)) {
        if (
          !/^#+\s*(?:人物|角色)[0-9一二三四五六七八九十]*\s*[:：]/m.test(chunk) &&
          !/\|\s*(?:\*\*)?L1/.test(chunk) &&
          !actorFilename &&
          !Object.keys(importLifeModules(chunk).modules).length
        )
          continue;
        const importedActor = parseFeishuActorMarkdown(chunk, actorKeys, filename);
        const form = importedActor.form;
        for (const message of importedActor.diagnostics ?? [])
          note('actor_modules_need_review', filename, `${filename}：${message}`);
        if (form.name === '未命名角色') {
          note('actor_missing_name', filename, `${filename}：人物缺少明确名字，未填入人物列表。`);
          continue;
        }
        if (existingNames.has(form.name)) {
          note(
            'actor_name_conflict',
            filename,
            `${filename}：已有同名人物「${form.name}」，未覆盖或合并，请明确稳定人物ID后人工整理。`,
          );
          continue;
        }
        if (form.name.length > 80) {
          note(
            'actor_name_budget',
            filename,
            `${filename}：人物名字超过80字符，原文保留，未填入。`,
          );
          continue;
        }
        const bounded = (field: string, value: string, max: number) => {
          if (value.length <= max) return value;
          note(
            'actor_field_unmapped',
            filename,
            `${filename}：「${form.name}」${field}过长，未截断；字段留空待整理。`,
          );
          return '';
        };
        const lifeModules: ImportedLifeModules = {};
        for (const [key, value] of Object.entries(importedActor.lifeModules ?? {})) {
          const complete = bounded('人物设定模块', value, PUBLICATION_LIFE_MODULE_MAX_CHARS);
          if (complete) lifeModules[key as keyof ImportedLifeModules] = complete;
        }
        const hasModules = Object.keys(lifeModules).length > 0;
        let background = bounded('background', form.background, 1200);
        if (/当前与后续|未来经历|后续经历|未来剧情|后期剧情|将会/.test(form.background)) {
          note(
            'actor_unconfirmed_background',
            filename,
            `${filename}：「${form.name}」背景含明确未来或后续标记，该字段留空，原文保留供分离。`,
          );
          background = '';
        }
        const persona = {
          background,
          voice: bounded('voice', form.voice, 600),
          motivation: bounded('motivation', form.rawMotivation, 600),
          boundaries: bounded('boundaries', form.boundaries, 600),
        };
        const partial = Object.values(persona).some((v) => !v.trim());
        if (partial) {
          note(
            'actor_missing_persona',
            filename,
            `${filename}：「${form.name}」有待整理的运行摘要${baseline.success && !hasModules ? '，已有合法草稿暂不加入' : '，已保留人物设定供整理，补齐前不能发布'}。`,
          );
          if (baseline.success && !hasModules) continue;
        }
        const identity = bounded('identity', form.identity, 160),
          appearance = bounded('appearance', form.appearance, 240);
        if (actors.length >= 12) {
          note('actor_count_budget', filename, '人物总数超过12，已阻止整批导入。', 'error');
          continue;
        }
        const actorKey = fresh('actor_import');
        actorKeys.push(actorKey);
        if (actors.some((a) => a.name === form.name))
          note(
            'duplicate_imported_name',
            filename,
            `${filename}：本批有同名人物，分别保留不同key；消息需明确发送者。`,
          );
        const publicCard: Record<string, unknown> = { traits: [] };
        if (identity) publicCard.identity = identity;
        if (appearance) publicCard.appearance = appearance;
        if (importedActor.introduction) {
          const introduction = bounded('公开介绍', importedActor.introduction, 1600);
          if (introduction) publicCard.introduction = introduction;
        }
        if (partial) partialActorIndices.add(actors.length);
        actors.push({
          key: actorKey,
          name: form.name,
          knownAtStart: form.knownAtStart,
          publicCard,
          privatePersona: persona,
          ...(hasModules ? { lifeModules } : {}),
        });
        summary.actors.push({
          name: form.name,
          key: actorKey,
          identity,
          sectionsCount: hasModules
            ? Object.keys(lifeModules).length
            : (identity ? 1 : 0) + Object.values(persona).filter((v) => v.trim()).length,
          completeness: partial ? 'partial' : 'complete',
        });
        if (!/开场(?:已)?认识[：:]/.test(chunk))
          note(
            'actor_knowledge_unspecified',
            filename,
            `${filename}：「${form.name}」未指定开场认识，保持未知人物，需作者确认后才能运行相关来信。`,
          );
        const relationship = explicitPlayerRelationship(chunk);
        if (relationship) {
          if (
            relationship.length > 400 ||
            /未来|将会|后续|后期|将成为|可能成为|以后/.test(relationship)
          ) {
            note(
              'relationship_unmapped',
              filename,
              `${filename}：「${form.name}」明确关系过长或含未来标记，原文保留待审，未创建关系。`,
            );
          } else {
            if (!Array.isArray(copy.relationships)) copy.relationships = [];
            const existingPair = copy.relationships.some(
              (r: Record<string, any>) =>
                (r.from?.kind === 'player' &&
                  r.to?.kind === 'actor' &&
                  r.to.actorKey === actorKey) ||
                (r.to?.kind === 'player' &&
                  r.from?.kind === 'actor' &&
                  r.from.actorKey === actorKey),
            );
            if (existingPair)
              note(
                'existing_relationship_preserved',
                filename,
                `${filename}：「${form.name}」已有与主角关系，原记录保持不变。`,
              );
            else if (copy.relationships.length >= 64)
              note(
                'relationship_count_budget',
                filename,
                '关系总数超过64，已阻止整批导入。',
                'error',
              );
            else
              copy.relationships.push({
                key: fresh('relation_import'),
                from: { kind: 'actor', actorKey },
                to: { kind: 'player' },
                description: relationship,
                visibility: { kind: 'player' },
              });
          }
        } else if (form.relationshipToPlayer) {
          note(
            'relationship_unmapped',
            filename,
            `${filename}：「${form.name}」未明确L5与主角/玩家字段，未推断初始关系，原文保留。`,
          );
        }
      }
    }
    const plot = parseFeishuPlotMarkdown(content, filename);
    if (plot.initialMessages.length || plot.candidates.length) {
      recognized = true;
      for (const msg of plot.initialMessages) {
        const match = actors.filter((a) => a.key === msg.actorName || a.name === msg.actorName);
        if (
          match.length !== 1 ||
          !msg.origin ||
          !match[0]!.knownAtStart ||
          (!scheduling &&
            (!msg.at ||
              !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(msg.at) ||
              !Number.isFinite(Date.parse(msg.at)) ||
              !copy.world?.startAt ||
              !Number.isFinite(Date.parse(copy.world.startAt))))
        ) {
          note(
            'opening_message_unmapped',
            filename,
            `${filename}：开场消息未写入，需唯一已认识的发送者及明确history/incoming来源；未提供时间可使用自动排期，非标准时间请交给Agent结合原文整理。`,
          );
          continue;
        }
        if (
          msg.text.length > 500 ||
          (msg.at && copy.world?.startAt && Date.parse(msg.at) > Date.parse(copy.world.startAt)) ||
          (msg.origin === 'history' &&
            msg.at &&
            copy.world?.startAt &&
            Date.parse(msg.at) >= Date.parse(copy.world.startAt))
        ) {
          note(
            'opening_message_invalid',
            filename,
            `${filename}：消息长度或相对世界开场时间非法，已阻止整批导入。`,
            'error',
          );
          continue;
        }
        const phone = object('phone');
        if (!Array.isArray(phone.messages)) phone.messages = [];
        if (phone.messages.length >= 40) {
          note('message_count_budget', filename, '开场消息总数超过40，已阻止整批导入。', 'error');
          continue;
        }
        phone.messages.push({
          key: fresh('msg_import'),
          actorKey: match[0]!.key,
          text: msg.text,
          at: msg.at ?? '',
          origin: msg.origin,
        });
        summary.initialMessagesCount++;
      }
      if (!Array.isArray(copy.candidates)) copy.candidates = [];
      for (const cand of plot.candidates) {
        const exactUnscoped = copy.candidates.some(
          (existing: Record<string, any>) =>
            typeof existing.key === 'string' &&
            /^[a-z][a-z0-9_]{0,31}$/.test(existing.key) &&
            existing.kind === 'candidate' &&
            existing.intent?.kind === 'editorial_only' &&
            Object.keys(existing.intent).length === 1 &&
            Object.keys(existing).every((k) =>
              [
                'key',
                'kind',
                'title',
                'editorialIntent',
                'actorKeys',
                'prerequisites',
                'mutuallyExclusiveNodeKeys',
                'intent',
              ].includes(k),
            ) &&
            ['actorKeys', 'prerequisites', 'mutuallyExclusiveNodeKeys'].every(
              (k) => Array.isArray(existing[k]) && existing[k].length === 0,
            ) &&
            existing.title === cand.title &&
            existing.editorialIntent === cand.editorialIntent,
        );
        if (exactUnscoped) {
          note(
            'exact_editorial_duplicate',
            filename,
            `${filename}：「${cand.title}」与无作用范围的已有幕后候选标题及完整原段落完全相同，跳过重复，保留原key。`,
          );
          continue;
        }
        if (copy.candidates.length >= 32) {
          note(
            'candidate_count_budget',
            filename,
            '候选总数超过32，已阻止整批导入；原段落仍保留。',
            'error',
          );
          break;
        }
        if (cand.title.length > 120 || cand.editorialIntent.length > 1600) {
          note(
            'candidate_budget',
            filename,
            `${filename}：候选标题或原段落超过协议长度，未写入此节点且未截断；原文在报告中待整理。`,
          );
          continue;
        }
        copy.candidates.push({
          key: fresh('cand_import'),
          kind: 'candidate',
          title: cand.title,
          editorialIntent: cand.editorialIntent,
          actorKeys: [],
          prerequisites: [],
          mutuallyExclusiveNodeKeys: [],
          intent: { kind: 'editorial_only' },
        });
        summary.candidatesCount++;
        note(
          'editorial_only_candidate',
          filename,
          `${filename}：「${cand.title}」仅保留幕后原段落，人物、地点、时间和可执行意图需作者整理；不会安排必发生事件。`,
        );
      }
    }
    if (!recognized)
      note(
        'unrecognized_document',
        filename,
        `${filename}：未识别支持格式，未填写字段，原文留在导入报告中。`,
      );
  }
  if (Array.isArray(original.actors) || actors.length) copy.actors = actors;
  let schedule: PublisherSchedule | undefined;
  if (scheduling && !summary.blocked) {
    const plan = planPublicationTimes(copy, { ...scheduling, sources: files });
    schedule = {
      status: plan.status,
      changes: plan.changes.slice(0, 256),
      issues: plan.issues.slice(0, 256),
    };
    if (plan.status === 'blocked') {
      note(
        'schedule_needs_review',
        '',
        '原稿时间存在冲突或尚未定位，未套用默认日期；可核对已提取内容，时间问题仍需结合原文整理，不能直接视为可发布。',
        plan.issues.every((i) =>
          [
            'scheduling_source_time_needs_review',
            'scheduling_unsupported_relative_delay',
            'scheduling_invalid_container',
          ].includes(i.code),
        )
          ? 'warning'
          : 'error',
      );
    } else copy = plan.updatedContent;
  }
  const result = PublishedWorldContentSchema.safeParse(copy);
  if (!result.success) {
    const signature = (i: { code: string; path: PropertyKey[]; message: string }) =>
      JSON.stringify([i.code, i.path, i.message]);
    const previous = new Set(baseline.success ? [] : baseline.error.issues.map(signature));
    for (const issue of result.error.issues) {
      let proposed: unknown = copy;
      for (const key of issue.path)
        proposed =
          proposed && typeof proposed === 'object'
            ? (proposed as Record<PropertyKey, unknown>)[key]
            : undefined;
      const pendingActor =
        issue.path[0] === 'actors' &&
        typeof issue.path[1] === 'number' &&
        partialActorIndices.has(issue.path[1]) &&
        issue.path[2] === 'privatePersona' &&
        proposed === '' &&
        (issue.code === 'too_small' || issue.code === 'custom');
      const pendingMissing =
        !baseline.success &&
        ((issue.code === 'invalid_type' && proposed === undefined) ||
          (issue.code === 'too_small' &&
            issue.path.length === 1 &&
            issue.path[0] === 'actors' &&
            actors.length < 2 &&
            pathValue(['actors']) === undefined));
      const path = issue.path.join('.');
      const pendingDate =
        !!scheduling &&
        schedule?.status === 'blocked' &&
        proposed === '' &&
        (path === 'world.startAt' ||
          /^history\.\d+\.occurredAt$/.test(path) ||
          /^phone\.(messages|invitations)\.\d+\.at$/.test(path) ||
          /^candidates\.\d+\.intent\.earliestAt$/.test(path));
      const introduced =
        !previous.has(signature(issue)) && !pendingMissing && !pendingActor && !pendingDate;
      note(
        introduced ? 'content_validation_failed' : 'draft_needs_completion',
        '',
        `草稿待核对：${issue.path.join('.')} ${issue.message}`,
        (!pendingDate && !pendingActor && baseline.success) || introduced ? 'error' : 'warning',
        issue.path.join('.'),
      );
    }
  }
  if (summary.blocked) {
    summary.actors = [];
    summary.initialMessagesCount = 0;
    summary.candidatesCount = 0;
    summary.world = undefined;
    return { updatedContent: original, summary, ...(schedule ? { schedule } : {}) };
  }
  return { updatedContent: copy, summary, ...(schedule ? { schedule } : {}) };
}
