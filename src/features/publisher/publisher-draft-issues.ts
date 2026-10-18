import { PublishedWorldContentSchema } from '../../contracts/published-world-content.ts';

export type DraftIssue = { path: string; message: string };

/** Human labels keep pre-save complaints readable for writers, not schema readers. */
const LABELS: Record<string, string> = {
  title: '标题',
  story: '故事',
  setup: '世界设定',
  protagonist: '主角',
  actors: '人物',
  characters: '人物',
  places: '地点',
  routes: '路线',
  history: '背景',
  candidates: '事件',
  relationships: '关系',
  lifeModules: '人物维度',
  publicCard: '公开名片',
  privatePersona: '幕后设定',
  name: '名称',
  key: '标识',
  description: '描述',
  knownAtStart: '开场可知',
  editorialIntent: '事件概述',
  actorKeys: '主要人物',
};

function label(path: readonly (string | number)[]): string {
  if (!path.length) return '整体内容';
  return path
    .map((part) => (typeof part === 'number' ? `第 ${part + 1} 项` : (LABELS[part] ?? part)))
    .join(' · ');
}

/** Pre-save self check: turn schema violations into "which field is wrong" for the workbench. */
export function draftIssues(content: unknown): DraftIssue[] {
  const parsed = PublishedWorldContentSchema.safeParse(content);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => ({
    path: label(
      issue.path.filter(
        (part): part is string | number => typeof part === 'string' || typeof part === 'number',
      ),
    ),
    message: issue.message,
  }));
}

export function describeDraftIssues(issues: readonly DraftIssue[], limit = 5): string {
  if (!issues.length) return '';
  const head = issues.slice(0, limit).map((issue) => `${issue.path}：${issue.message}`);
  const rest = issues.length > limit ? `；另有 ${issues.length - limit} 处` : '';
  return `保存前发现 ${issues.length} 处需要修正 —— ${head.join('；')}${rest}`;
}

export class DraftIssuesError extends Error {
  readonly code = 'INVALID_INPUT' as const;
  readonly issues: DraftIssue[];
  constructor(issues: DraftIssue[]) {
    super(describeDraftIssues(issues));
    this.name = 'DraftIssuesError';
    this.issues = issues;
  }
}
