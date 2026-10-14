import type { PublisherWork } from '../../contracts/world-publisher.ts';
import type { PublisherWorkbenchDraft } from '../../contracts/publisher-workbench.ts';
import {
  PublisherPreparationInputSchema,
  type PublisherPreparationRecord,
} from '../../contracts/publisher-preparation.ts';
import { mergePublicationPreparation } from '../../modules/settings/domain/publication-preparation.ts';
import { readOverallSetting } from './publisher-overall-setting.ts';
import {
  currentCharacterManuscripts,
  quoteCharacterProse,
} from './publisher-character-manuscript.ts';
import type { PublisherClient } from './publisher-client.ts';

type Client = Pick<
  PublisherClient,
  | 'save'
  | 'get'
  | 'check'
  | 'startTrial'
  | 'startCharacterTrial'
  | 'prepareTrial'
  | 'getPreparation'
>;
export type TrialAttempt = {
  commandId: string;
  workId: string;
  draftVersion: number;
  contentHash: string;
};
export type TrialAttemptStore = {
  get(key: string): TrialAttempt | undefined;
  put(key: string, value: TrialAttempt): void;
};
export class PublisherTrialError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
/** JSON equality ignores server JSONB key order, but never normalizes authored text or arrays. */
export function trialJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(trialJson).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(
          (key) => JSON.stringify(key) + ':' + trialJson((value as Record<string, unknown>)[key]),
        )
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function trialDraftChanged(work: PublisherWork, draft: PublisherWorkbenchDraft) {
  return work.title !== draft.title || trialJson(work.draft.content) !== trialJson(draft.content);
}
export function trialManuscripts(content: Record<string, unknown>) {
  const sources = currentCharacterManuscripts(content);
  for (const actor of Array.isArray(content.actors) ? content.actors : []) {
    if (!actor || typeof actor !== 'object' || typeof actor.name !== 'string') continue;
    const modules =
      actor.lifeModules && typeof actor.lifeModules === 'object' ? actor.lifeModules : {};
    if (Object.values(modules).some((value) => typeof value === 'string' && value.trim())) continue;
    const source = sources.find((item) => item.filename === `人物表单_${actor.name}.md`);
    if (!source) continue;
    const persona =
      actor.privatePersona && typeof actor.privatePersona === 'object' ? actor.privatePersona : {};
    const card = actor.publicCard && typeof actor.publicCard === 'object' ? actor.publicCard : {};
    const authored = [
      ['已有身份', card.identity],
      ['已有背景', persona.background],
      ['已有说话方式', persona.voice],
      ['已有动机', persona.motivation],
      ['已有边界', persona.boundaries],
    ].filter(([, value]) => typeof value === 'string' && value.trim());
    if (authored.length)
      source.content +=
        '\n\n' +
        authored
          .map(([label, value]) => `## ${label}\n${quoteCharacterProse(value as string)}`)
          .join('\n\n');
  }
  const overall = readOverallSetting(content);
  if (overall.text.trim())
    sources.unshift({
      filename: overall.source === 'authored' ? '总体设定原稿.md' : '已有世界设定.md',
      content: '# 总体设定\n' + quoteCharacterProse(overall.text),
    });
  return sources;
}
function issuesMessage(issues: { code: string; path: (string | number)[] }[]) {
  const completion = issues.some((i) => i.code.startsWith('unsupported_director_completion'));
  if (completion)
    return '事件要求完成后才能继续，但这类完成条件暂不能运行。请保留原稿，调整试演范围后再试。';
  const labels: Record<string, string> = {
    actors: '人物设定',
    world: '世界开场',
    protagonist: '主角处境',
    phone: '开场聊天或朋友圈',
    candidates: '事件安排',
    timeline: '剧情先后',
    history: '过去经历',
    media: '图片素材',
  };
  const parts = [...new Set(issues.map((i) => labels[String(i.path[0])] ?? '相关内容'))];
  return `试演准备还有 ${issues.length} 处需核对：${parts.slice(0, 3).join('、')}。原稿已保留，没有启动手机或采用这份补充。`;
}

/** Coordinates one paid preparation at most; uncertain operations are only read on subsequent clicks. */
export class PublisherTrialPreparation {
  private attempts = new Map<string, TrialAttempt>();
  private client: Client;
  private newId: () => string;
  private store?: TrialAttemptStore;
  constructor(client: Client, newId: () => string, store?: TrialAttemptStore) {
    this.client = client;
    this.newId = newId;
    this.store = store;
  }
  private async save(work: PublisherWork, draft: PublisherWorkbenchDraft) {
    try {
      return await this.client.save(work, draft);
    } catch (error) {
      if ((error as { code?: string })?.code !== 'UNAVAILABLE') throw error;
      // Read back a possibly committed save before treating it as a failure. No new write or model.
      const actual = await this.client.get(work.id);
      if (!trialDraftChanged(actual, draft)) return actual;
      throw error;
    }
  }
  async open(
    initial: PublisherWork,
    draft: PublisherWorkbenchDraft,
    options: {
      onWork: (work: PublisherWork) => void;
      onProgress: (message: string) => void;
      mode?: 'character' | 'world';
    },
  ) {
    let work = initial;
    if (trialDraftChanged(work, draft)) {
      options.onProgress('正在保存你刚写的设定…');
      work = await this.save(work, draft);
      options.onWork(work);
    }
    options.onProgress('正在检查这份草稿能否直接试演…');
    const check = await this.client.check(work);
    if (
      check.workId !== work.id ||
      check.draftVersion !== work.draftVersion ||
      check.contentHash !== work.draft.contentHash
    )
      throw new PublisherTrialError(
        'VERSION_CONFLICT',
        '草稿已有变化，请核对最新保存内容后再试演。',
      );
    const issues = check.issues.filter((issue) => issue.code !== 'trial_unverified');
    let supplemented = false;
    if (
      issues.length ||
      check.issuesTruncated ||
      check.missingCapabilities.length ||
      check.status === 'invalid'
    ) {
      const sources = trialManuscripts(work.draft.content);
      if (!sources.length)
        throw new PublisherTrialError(
          'TRIAL_SOURCE_MISSING',
          '请先填写人物姓名和设定，或写下总体设定，再开始试演。',
        );
      const key = `${work.id}:${work.draft.contentHash}`;
      let attempt = this.attempts.get(key) ?? this.store?.get(key);
      let record: PublisherPreparationRecord;
      if (attempt) {
        this.attempts.set(key, attempt);
        options.onProgress('正在核对上一次试演准备的结果，不会重新生成…');
        record = await this.client.getPreparation(work.id, attempt.commandId);
      } else {
        attempt = {
          commandId: this.newId(),
          workId: work.id,
          draftVersion: work.draftVersion,
          contentHash: work.draft.contentHash,
        };
        const input = PublisherPreparationInputSchema.safeParse({
          commandId: attempt.commandId,
          expectedDraftVersion: work.draftVersion,
          scope: 'world',
          currentContent: work.draft.content,
          sources,
        });
        if (!input.success)
          throw new PublisherTrialError(
            'TRIAL_SOURCE_BUDGET',
            '这份设定暂时不能一次完整准备。文字仍在，请精简或分批整理后再试演。',
          );
        this.attempts.set(key, attempt);
        this.store?.put(key, attempt);
        options.onProgress('正在根据你的设定补齐试演所需的世界和手机内容，可能需要一两分钟…');
        record = await this.client.prepareTrial(work.id, input.data);
      }
      if (
        record.workId !== work.id ||
        record.commandId !== attempt.commandId ||
        record.draftVersion !== attempt.draftVersion ||
        record.material.scope !== 'world' ||
        trialJson(record.material.currentContent) !== trialJson(work.draft.content) ||
        trialJson(record.material.sources.slice(0, sources.length)) !== trialJson(sources)
      )
        throw new PublisherTrialError(
          'VERSION_CONFLICT',
          '准备结果与这份设定不一致，未采用。请核对当前草稿。',
        );
      if (record.status === 'running' || record.status === 'unknown')
        throw new PublisherTrialError(
          'TRIAL_PENDING',
          '这次准备结果尚未确认。再次点击试演会核对同一次操作，不会重新生成。',
        );
      if (record.status !== 'succeeded' || !record.result)
        throw new PublisherTrialError(
          'TRIAL_FAILED',
          '这次没有得到可试演的完整结果，原稿已保存。请核对设定后再试演；相同内容会查看原结果。',
        );
      if (record.result.scope !== 'world' || record.result.issues.length)
        throw new PublisherTrialError('TRIAL_INVALID', issuesMessage(record.result.issues));
      const proposed = record.result.updatedContent;
      const preserved = mergePublicationPreparation(work.draft.content, proposed).updatedContent;
      if (trialJson(preserved) !== trialJson(proposed))
        throw new PublisherTrialError(
          'TRIAL_SOURCE_CHANGED',
          '准备结果改动了你已有的设定，未自动采用。原稿仍保留，请先核对。',
        );
      const preparedDraft = { title: work.title, content: proposed };
      if (trialDraftChanged(work, preparedDraft)) {
        options.onProgress('正在保存为试演补齐的内容，尚未发布…');
        work = await this.save(work, preparedDraft);
        options.onWork(work);
      }
      supplemented = true;
    }
    options.onProgress('正在打开这份草稿的真实试演手机…');
    const result = await (options.mode === 'world'
      ? this.client.startTrial(work)
      : this.client.startCharacterTrial(work));
    return { work, result, supplemented };
  }
}
