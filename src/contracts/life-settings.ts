import { z } from 'zod';
import { SeedStorySchema } from './seeds.ts';

// Authoring content only: account ownership, review decisions, published versions
// and player saves belong to trusted persistence, never to an author's payload.
const localId = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const source = z.strictObject({
  id: localId,
  title: text(120),
  url: z
    .string()
    .url()
    .max(1000)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password;
      } catch {
        return false;
      }
    }, '引用需使用不含登录凭据的 HTTPS 链接'),
});

export const LifeSettingContentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.enum(['original', 'historical_fiction', 'public_figure_fiction']),
    inspiration: z.strictObject({ name: text(80), fictionalFraming: text(300) }).nullable(),
    story: SeedStorySchema,
    setup: z.strictObject({ identity: text(80), place: text(120), tone: text(100) }),
    protagonist: z.strictObject({ desire: text(300), dilemma: text(300) }),
    characters: z
      .array(
        z.strictObject({
          id: localId.refine((id) => id !== 'protagonist'),
          name: text(80),
          role: text(160),
          desire: text(200),
          voice: text(200),
        }),
      )
      .min(2)
      .max(7),
    relationships: z
      .array(
        z.strictObject({
          fromId: localId,
          toId: localId,
          context: text(200),
          disclosure: z.enum(['never', 'case_by_case']),
        }),
      )
      .min(1)
      .max(28),
    threads: z
      .array(
        z.strictObject({
          id: localId,
          question: text(200),
          stakes: text(300),
          // Editorial intent, not executable conditions or authority to take actions.
          entryCue: text(300),
          involvedCharacterIds: z.array(localId).min(1).max(7),
          possibleOutcomes: z.array(text(200)).min(2).max(4),
        }),
      )
      .min(1)
      .max(5),
    openingCharacterId: localId,
    openingThreadId: localId,
    sources: z.array(source).max(15),
    contextNotes: z
      .array(
        z.strictObject({
          text: text(300),
          basis: z.enum(['invented', 'source_claim']),
          sourceIds: z.array(localId).max(5),
        }),
      )
      .max(20),
  })
  .superRefine((setting, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    const unique = (ids: string[], path: (string | number)[]) => {
      if (new Set(ids).size !== ids.length) issue(path, '引用标识不可重复');
    };
    if ((setting.kind === 'original') !== (setting.inspiration === null))
      issue(['inspiration'], '借鉴真实人物时需说明虚构演绎范围；原创设定不填写人物借鉴');
    unique(
      setting.characters.map((item) => item.id),
      ['characters'],
    );
    unique(
      setting.threads.map((item) => item.id),
      ['threads'],
    );
    unique(
      setting.sources.map((item) => item.id),
      ['sources'],
    );
    const cast = new Set(setting.characters.map((item) => item.id));
    const participants = new Set(['protagonist', ...cast]);
    unique(
      setting.relationships.map((item) => `${item.fromId}:${item.toId}`),
      ['relationships'],
    );
    setting.relationships.forEach((relation, index) => {
      if (
        !participants.has(relation.fromId) ||
        !participants.has(relation.toId) ||
        relation.fromId === relation.toId
      )
        issue(['relationships', index], '关系须连接两个不同且已定义的人物');
    });
    setting.threads.forEach((thread, index) => {
      unique(thread.involvedCharacterIds, ['threads', index, 'involvedCharacterIds']);
      if (thread.involvedCharacterIds.some((id) => !cast.has(id)))
        issue(['threads', index, 'involvedCharacterIds'], '故事线引用了未定义的人物');
    });
    const openingThread = setting.threads.find((item) => item.id === setting.openingThreadId);
    if (!cast.has(setting.openingCharacterId)) issue(['openingCharacterId'], '开场人物不存在');
    if (!openingThread) issue(['openingThreadId'], '开场故事线不存在');
    else if (!openingThread.involvedCharacterIds.includes(setting.openingCharacterId))
      issue(['openingCharacterId'], '开场人物须参与开场故事线');
    const sources = new Set(setting.sources.map((item) => item.id));
    setting.contextNotes.forEach((note, index) => {
      unique(note.sourceIds, ['contextNotes', index, 'sourceIds']);
      if (note.basis === 'source_claim' && note.sourceIds.length === 0)
        issue(['contextNotes', index, 'sourceIds'], '资料性陈述需要引用；引用存在不等于已经核实');
      if (note.basis === 'invented' && note.sourceIds.length > 0)
        issue(['contextNotes', index, 'sourceIds'], '虚构补充不可伪装成有来源的事实');
      if (note.sourceIds.some((id) => !sources.has(id)))
        issue(['contextNotes', index, 'sourceIds'], '资料引用不存在');
    });
    if (new TextEncoder().encode(JSON.stringify(setting)).byteLength > 16000)
      issue([], '设定内容过长，请收拢首段体验');
  });

export type LifeSettingContent = z.infer<typeof LifeSettingContentSchema>;
