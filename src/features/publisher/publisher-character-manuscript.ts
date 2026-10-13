import { CHARACTER_MODULES, characterModuleText } from './publisher-character-model.ts';

type Source = { filename: string; content: string };
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
/** Quote authored blocks without rewriting their characters; nested names remain part of this person's prose. */
export function quoteCharacterProse(text: string) {
  return text.replace(/^/gm, '> ');
}
export function characterManuscriptSource(
  content: Record<string, unknown>,
  actorKey: string,
): Source | null {
  const actors = Array.isArray(content.actors)
    ? content.actors.filter(record).filter((a) => a.key === actorKey)
    : [];
  if (actors.length !== 1) return null;
  const actor = actors[0]!,
    name = typeof actor.name === 'string' ? actor.name : '';
  if (
    !name.trim() ||
    name.length > 80 ||
    /[\r\n|：:()（）]/.test(name) ||
    /^新人物\s*\d+$/.test(name.trim())
  )
    return null;
  if (
    (Array.isArray(content.actors) ? content.actors : [])
      .filter(record)
      .filter((a) => a.name === name).length !== 1
  )
    return null;
  const card = record(actor.publicCard) ? actor.publicCard : {};
  const blocks = [`# 人物：${name}`];
  for (const module of CHARACTER_MODULES) {
    const raw = characterModuleText(content, actorKey, module.key);
    if (raw.trim()) blocks.push(`## ${module.label}\n${quoteCharacterProse(raw)}`);
  }
  const introduction = typeof card.introduction === 'string' ? card.introduction : '';
  if (introduction.trim())
    blocks.push(`## 给玩家看的角色介绍\n${quoteCharacterProse(introduction)}`);
  return { filename: `人物表单_${name}.md`, content: blocks.join('\n\n') };
}
export function currentCharacterManuscripts(content: Record<string, unknown>): Source[] {
  return (Array.isArray(content.actors) ? content.actors : []).filter(record).flatMap((actor) => {
    const source =
      typeof actor.key === 'string' ? characterManuscriptSource(content, actor.key) : null;
    return source ? [source] : [];
  });
}
