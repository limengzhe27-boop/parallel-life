// Local launch compatibility only; cadence and loop behavior live in the shared application.
import {
  PROACTIVE_WORKER_DEFAULTS,
  proactiveWorkerPolicy,
  runProactiveLoop,
} from '../src/modules/world/application/run-proactive-loop.ts';
export const LOCAL_PROACTIVE_DEFAULTS = PROACTIVE_WORKER_DEFAULTS;
export function localProactivePolicy(input = {}) {
  try {
    return proactiveWorkerPolicy(input);
  } catch {
    throw Error('INVALID_LOCAL_PROACTIVE_POLICY');
  }
}
export const runLocalProactiveLoop = runProactiveLoop;
