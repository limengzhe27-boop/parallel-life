/** Bounded authoring hints only. Existing receipts must never be reclassified. */
type Source = { filename: string; content: string };
export type PreparationScope = 'world' | 'characters';
const characterLabel = /人物|角色|朋友|character|people|actor/i;
const worldLabel = /世界|剧情|剧本|开场|地点|场景|故事大纲|world|plot|opening|location|scene/i;
function headings(content: string): string[] {
  return content.split(/\r?\n/).filter((line) => /^\s{0,3}#{1,6}\s/.test(line));
}
export function detectPublisherPreparationScope(sources: readonly Source[]): {
  scope: PreparationScope;
  confidence: 'recognized' | 'uncertain';
} {
  if (!sources.length || sources.length > 32 || sources.some((s) => s.content.length > 131072))
    return { scope: 'world', confidence: 'uncertain' };
  const labels = sources.map((s) => [s.filename, ...headings(s.content)].join('\n'));
  if (labels.some((s) => worldLabel.test(s))) return { scope: 'world', confidence: 'recognized' };
  if (labels.every((s) => characterLabel.test(s)))
    return { scope: 'characters', confidence: 'recognized' };
  return { scope: 'world', confidence: 'uncertain' };
}

/** Only explicit names/character headings qualify; incidental names in prose do not. */
export function preparationCharacterNames(sources: readonly Source[]): string[] {
  const names = new Set<string>();
  const add = (raw: string) => {
    const name = raw
      .replace(/\*\*/g, '')
      .trim()
      .replace(/[（(][^()（）]*[)）]\s*$/, '')
      .trim();
    if (
      !name ||
      name.length > 80 ||
      /[|：:\n。；;]/.test(name) ||
      /^(?:人物|角色|朋友)(?:设定|档案|介绍|简介|小传|原稿|文稿|列表|资料|关系|背景)?(?:[-_\s]*\d+)?$/.test(
        name,
      ) ||
      /^(?:人物|角色|朋友|姓名|名字|人物设定|人物档案|人物介绍|角色设定|角色档案|人物关系|背景|外貌|性格|动机|边界|设定|简介|原稿|文稿|未命名|说明|主角|character|people|actor)(?:\s*\d+)?$/i.test(
        name,
      )
    )
      return;
    names.add(name);
  };
  for (const source of sources.slice(0, 32)) {
    const text = source.content.slice(0, 131072);
    let explicit = false;
    for (const line of text.split(/\r?\n/)) {
      const match =
        line.match(
          /^\s*(?:#{1,6}\s*|[-*]\s*)?(?:\*\*)?(?:姓名|名字|人物(?:\s*\d+)?|角色(?:\s*\d+)?|name)(?:\*\*)?\s*[:：]\s*(.+?)\s*$/i,
        ) ?? line.match(/^\s*\|\s*(?:\*\*)?(?:姓名|名字|name)(?:\*\*)?\s*\|\s*([^|]+)\|/i);
      if (match) {
        add(match[1]!);
        explicit = true;
      }
      // A named top-level heading in a character file is an explicit subject.
      else if (characterLabel.test(source.filename) && /^#\s+/.test(line)) {
        const before = names.size;
        add(line.replace(/^#\s+/, ''));
        explicit ||= names.size > before;
      }
    }
    // A single named file can itself identify its subject, but a generic file cannot.
    if (!explicit) {
      const basename = source.filename
        .split(/[\\/]/)
        .at(-1)!
        .replace(/\.(?:md|txt)$/i, '');
      if (
        characterLabel.test(source.filename) ||
        headings(text).some((s) => characterLabel.test(s))
      )
        add(basename.replace(/^(?:人物|角色|朋友)[-_\s：:]+/, ''));
    }
  }
  return [...names].slice(0, 100);
}
