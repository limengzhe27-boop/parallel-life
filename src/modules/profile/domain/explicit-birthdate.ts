/** Only unambiguous self-reported birth dates may update the real profile. */
export function explicitBirthdate(text: string): string | undefined {
  if (/[“”「」『』"‘’]|如果|假如|要是|[？?]/u.test(text)) return undefined;
  let result: string | undefined;
  for (const clause of text.split(/[，,。；;！!\n]/u)) {
    const value = clause.trim();
    if (/不是|并非|不记得|忘了|可能|好像|大概|朋友|同学|他说|她说/u.test(value)) continue;
    const match =
      value.match(
        /^(?:其实|更正为|更正一下|准确来说)?\s*(?:我(?:其实)?是|我(?:的生日是|出生于|出生在|生于))\s*(\d{4}|\d{2})(?:年|[-/.])(\d{1,2})(?:月|[-/.])(\d{1,2})(?:日|号)?(?:出生的?)?$/u,
      ) ??
      value.match(
        /^(?:其实)?\s*(?:我(?:其实)?是|我出生于|我生于)\s*(\d{4}|\d{2})年(?:的|出生的?|生人)$/u,
      );
    if (!match) continue;
    let year = Number(match[1]);
    if (year < 100) year += year > 40 ? 1900 : 2000;
    if (year < 1900 || year > 2030) continue;
    if (!match[2]) {
      result = String(year);
      continue;
    }
    const month = Number(match[2]),
      day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    )
      continue;
    result = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return result;
}
