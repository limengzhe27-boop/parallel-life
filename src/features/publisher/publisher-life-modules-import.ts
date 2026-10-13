/** Exact, local extraction of authored character sections. No invented summaries or public facts. */
export type ImportedLifeModules = Partial<
  Record<'lifeContext' | 'traits' | 'drives' | 'behavior' | 'relationships', string>
>;

export type LifeModuleImport = {
  modules: ImportedLifeModules;
  introduction?: string;
  diagnostics: string[];
};

const names = [
  ['lifeContext', /^(?:L1\s*)?(?:Life\s+Context\s*)?(?:人生背景)?$/i],
  ['traits', /^(?:L2\s*)?(?:Traits\s*)?(?:人格特质)?$/i],
  ['drives', /^(?:L3\s*)?(?:Drives\s*(?:&|and)?\s*Values\s*)?(?:动机与价值观)?$/i],
  ['behavior', /^(?:L4\s*)?(?:Behavior(?:al)?\s*(?:Patterns?)?\s*)?(?:行为模式)?$/i],
  ['relationships', /^(?:L5\s*)?(?:Relationship(?:s)?\s*(?:Model)?\s*)?(?:关系模型)?$/i],
] as const;

function clean(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*|__/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\\&/g, '&')
    .replace(/\\\|/g, '|')
    .trim();
}

function moduleKey(value: string): keyof ImportedLifeModules | undefined {
  const label = clean(value)
    .replace(/[：:]\s*$/, '')
    .trim();
  if (!label) return undefined;
  return names.find(([, pattern]) => pattern.test(label))?.[0];
}

function cells(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return undefined;
  if (/^\|[\s\-:|]+\|$/.test(trimmed)) return [];
  return trimmed
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map(clean);
}

function authoredSection(lines: string[], index: number): string {
  const heading = /^(#{1,6})\s+/.exec(lines[index]!);
  if (!heading) return '';
  const depth = heading[1]!.length;
  const body: string[] = [];
  let excludedDepth: number | undefined;
  let excludedPlain = false;
  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const next = /^(#{1,6})\s+(.+)/.exec(line);
    if (next && next[1]!.length <= depth) break;
    if (next && /^(?:游戏中的作用|创作参考)\s*$/.test(clean(next[2]!))) {
      excludedDepth = next[1]!.length;
      continue;
    }
    if (next && excludedDepth !== undefined && next[1]!.length <= excludedDepth)
      excludedDepth = undefined;
    if (excludedDepth !== undefined) continue;
    if (/^(?:游戏中的作用|创作参考)(?:\s*[：:]|\s*$)/.test(clean(line))) {
      excludedPlain = true;
      continue;
    }
    if (next) excludedPlain = false;
    if (excludedPlain) continue;
    if (/^(?:需要刻画的信息)\s*[：:]?\s*$/.test(clean(line))) continue;
    body.push(line);
  }
  return body.join('\n').trim();
}

export function importLifeModules(content: string): LifeModuleImport {
  const modules: ImportedLifeModules = {};
  const diagnostics: string[] = [];
  const append = (key: keyof ImportedLifeModules, value: string) => {
    if (!value.trim()) return;
    modules[key] = [modules[key], value].filter(Boolean).join('\n\n');
  };
  const lines = content.split(/\r?\n/);
  let header: string[] | undefined;
  let previous: keyof ImportedLifeModules | undefined;
  let tableRecognized = false;
  for (const line of lines) {
    const row = cells(line);
    if (row === undefined) {
      header = undefined;
      previous = undefined;
      continue;
    }
    if (!row.length) continue;
    if (row.some((cell) => cell === '需要刻画的信息')) {
      header = row;
      previous = undefined;
      continue;
    }
    const infoIndex = header ? header.indexOf('需要刻画的信息') : 2;
    const key = moduleKey(row[0] ?? '') ?? moduleKey(row[1] ?? '');
    const continuation = (row[0] ?? '') === '' && !moduleKey(row[1] ?? '');
    const resolved = key ?? (continuation ? previous : undefined);
    if (!resolved) {
      previous = undefined;
      continue;
    }
    previous = resolved;
    tableRecognized = true;
    if (row.length <= infoIndex) {
      diagnostics.push('人物表格的内容列缺失，已保留原稿，待整理。');
      continue;
    }
    // A named header is authoritative; never absorb the separate game-use column.
    const preceding = header
      ? row.slice(0, infoIndex).filter((cell) => !!cell && !moduleKey(cell))
      : [];
    append(resolved, [...preceding, row[infoIndex]!].filter(Boolean).join('\n'));
  }
  for (let i = 0; i < lines.length; i++) {
    const heading = /^#{1,6}\s+(.+)/.exec(lines[i]!);
    if (!heading) continue;
    const key = moduleKey(heading[1]!);
    if (key) append(key, authoredSection(lines, i));
  }
  let introduction: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const heading = /^#{1,6}\s+(角色介绍|给玩家的介绍|给用户的介绍|公开介绍)\s*$/.exec(
      clean(lines[i]!),
    );
    const label = /^(角色介绍|给玩家的介绍|给用户的介绍|公开介绍)\s*[：:]\s*(.+)$/.exec(
      clean(lines[i]!),
    );
    const value = heading ? authoredSection(lines, i) : label?.[2]?.trim();
    if (!value) continue;
    if (introduction && introduction !== value)
      diagnostics.push('文稿包含不同的公开角色介绍，暂保留第一段，请核对原稿。');
    else introduction = value;
  }
  if (
    !tableRecognized &&
    !Object.keys(modules).length &&
    /需要刻画的信息/.test(content) &&
    /游戏中的作用/.test(content)
  )
    diagnostics.push('人物表格失去列边界，无法可靠区分人物设定与创作说明；原稿完整保留，待整理。');
  return { modules, ...(introduction ? { introduction } : {}), diagnostics };
}
