import {
  DEFAULT_PROACTIVE_CLAIM_TIMING,
  type ProactiveTickPolicy,
  type ProactiveClaimTiming,
} from './run-proactive-scheduler.ts';

export type ProactiveWorkerPolicy = ProactiveTickPolicy &
  ProactiveClaimTiming & { checkEveryMs: number };
export const PROACTIVE_WORKER_DEFAULTS: Readonly<ProactiveWorkerPolicy> = Object.freeze({
  checkEveryMs: 15_000,
  maxWorlds: 2,
  ...DEFAULT_PROACTIVE_CLAIM_TIMING,
  maxElapsedMs: 15_000,
});
export function proactiveWorkerPolicy(
  input: Partial<ProactiveWorkerPolicy> = {},
): Readonly<ProactiveWorkerPolicy> {
  const policy = { ...PROACTIVE_WORKER_DEFAULTS, ...input };
  const bounds: [keyof ProactiveWorkerPolicy, number, number][] = [
    ['checkEveryMs', 5000, 60000],
    ['maxWorlds', 1, 2],
    ['cooldownSeconds', 30, 3600],
    ['leaseSeconds', 30, 600],
    ['maxElapsedMs', 1000, 240000],
  ];
  for (const [key, min, max] of bounds)
    if (!Number.isSafeInteger(policy[key]) || policy[key] < min || policy[key] > max)
      throw Error('INVALID_PROACTIVE_WORKER_POLICY');
  return Object.freeze(policy);
}
export type ProactiveTickResult = {
  claimed: number;
  advanced: number;
  messages: number;
  failed: number;
};
/** Shared by a hosted worker and the local launcher. SQL owns cross-process claims;
 * a tick completes before another starts, including during graceful shutdown. */
export async function runProactiveLoop<Result = ProactiveTickResult>({
  tick,
  shutdown,
  sleep,
  policy = PROACTIVE_WORKER_DEFAULTS,
  once = false,
  onResult = () => {},
  onError = () => {},
}: {
  tick: () => Promise<Result>;
  shutdown: AbortSignal;
  sleep: (ms: number, signal: AbortSignal) => Promise<unknown>;
  policy?: Partial<ProactiveWorkerPolicy>;
  once?: boolean;
  onResult?: (result: Result) => void | Promise<void>;
  onError?: () => void | Promise<void>;
}) {
  const selected = proactiveWorkerPolicy(policy);
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
