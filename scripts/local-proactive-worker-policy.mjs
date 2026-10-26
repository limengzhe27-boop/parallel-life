/** Local operational cadence: a check only offers original business admission an execution slot. */
export const LOCAL_PROACTIVE_DEFAULTS = Object.freeze({
  checkEveryMs: 15_000,
  maxWorlds: 2,
  cooldownSeconds: 60,
  leaseSeconds: 60,
  maxElapsedMs: 15_000,
});
export function localProactivePolicy(input = {}) {
  const policy = { ...LOCAL_PROACTIVE_DEFAULTS, ...input };
  for (const [key, min, max] of [
    ['checkEveryMs', 5000, 60000],
    ['maxWorlds', 1, 2],
    ['cooldownSeconds', 30, 3600],
    ['leaseSeconds', 30, 600],
    ['maxElapsedMs', 1000, 240000],
  ]) {
    if (!Number.isSafeInteger(policy[key]) || policy[key] < min || policy[key] > max)
      throw Error('INVALID_LOCAL_PROACTIVE_POLICY');
  }
  return Object.freeze(policy);
}
/** No overlapping ticks in this process. Paid in-flight work finishes before shutdown. */
export async function runLocalProactiveLoop({
  tick,
  shutdown,
  sleep,
  policy = LOCAL_PROACTIVE_DEFAULTS,
  once = false,
  onResult = () => {},
  onError = () => {},
}) {
  const selected = localProactivePolicy(policy);
  let ticks = 0;
  while (!shutdown.aborted) {
    try {
      const result = await tick();
      ticks++;
      await onResult(result);
    } catch {
      ticks++;
      await onError();
    }
    if (once || shutdown.aborted) break;
    await sleep(selected.checkEveryMs, shutdown).catch(() => {});
  }
  return { ticks };
}
