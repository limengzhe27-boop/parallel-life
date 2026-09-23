/**
 * Model output is data, not a contract: it arrives with prose, fences, extra
 * fields or a trailing comma. Every field we consume is still validated by the
 * caller — this helper only refuses to throw away an otherwise usable reply, so
 * a stray key cannot turn a valid world into a failed task.
 */
export function extractJsonObject(raw: string): unknown {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;
  const start = trimmed.indexOf('{');
  if (start < 0) throw new Error('MODEL_OUTPUT_WITHOUT_OBJECT');
  let depth = 0,
    inString = false,
    escaped = false;
  for (let index = start; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = tryParse(trimmed.slice(start, index + 1));
        if (candidate !== undefined) return candidate;
        break;
      }
    }
  }
  throw new Error('MODEL_OUTPUT_NOT_JSON');
}

function tryParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    /* Retry once without trailing commas, the most common formatting artefact. */
  }
  try {
    return JSON.parse(value.replace(/,(\s*[}\]])/g, '$1'));
  } catch {
    return undefined;
  }
}
