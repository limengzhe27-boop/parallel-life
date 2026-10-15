/** Runtime source excerpts only. The stored manuscript is never changed by this selector. */
export function authoredSourceExcerpt(
  source: string,
  topic: string,
  budget: number,
  maxUnits = Number.POSITIVE_INFINITY,
): string {
  const limit = Number.isFinite(budget) ? Math.max(0, Math.floor(budget)) : 0;
  if (!limit || maxUnits < 1 || !source.trim()) return '';
  if (source.length <= limit) return source;

  // Keep normal sentences intact. Only oversized indivisible units need raw source windows.
  // Half-budget windows leave room for both the opening identity and a topical passage.
  const windowSize = Math.max(1, Math.floor((limit - 1) / 2));
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const units: string[] = [];
  for (const raw of source.split(/\n+|(?<=[。！？；.!?;])/u)) {
    const unit = raw.trim();
    if (!unit) continue;
    if (unit.length <= limit) {
      units.push(unit);
      continue;
    }
    let window = '';
    for (const { segment } of segmenter.segment(unit)) {
      // An adversarial combining sequence can itself exceed the budget. Code points
      // are the final boundary; never emit a dangling UTF-16 surrogate.
      const pieces = segment.length > windowSize ? Array.from(segment) : [segment];
      for (const piece of pieces) {
        if (window.length + piece.length > windowSize && window) {
          units.push(window);
          window = '';
        }
        if (piece.length <= windowSize) window += piece;
      }
    }
    if (window) units.push(window);
  }

  const words = [...new Set(topic.match(/[\p{Script=Han}]{2}|[a-zA-Z]{3,}/gu) ?? [])];
  const ranked = units
    .map((text, index) => ({
      text,
      index,
      score: words.reduce((sum, word) => sum + Number(text.includes(word)), 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const selected: typeof ranked = [];
  let size = 0;
  const append = (unit: (typeof ranked)[number]) => {
    const cost = unit.text.length + Number(selected.length > 0);
    if (selected.length >= maxUnits || size + cost > limit) return;
    selected.push(unit);
    size += cost;
  };
  const opening = ranked.find((unit) => unit.index === 0);
  if (opening) append(opening);
  for (const unit of ranked) {
    if (unit.index !== 0) append(unit);
  }
  return selected
    .sort((a, b) => a.index - b.index)
    .map((unit) => unit.text)
    .join('\n');
}
