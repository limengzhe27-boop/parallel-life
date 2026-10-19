import { classifyAgentRejection } from '../modules/world/application/agent-rejection-classification.ts';
import { ErrorCode } from '../contracts/api.ts';

/** Operational metadata only; never a retry/authorization decision or a model input. */
export type FailureDiagnosticStage =
  | 'accept'
  | 'snapshot'
  | 'preflight'
  | 'send'
  | 'model'
  | 'response_store'
  | 'decode'
  | 'validate'
  | 'execute'
  | 'commit'
  | 'receipt'
  | 'projection';
export type FailureDiagnosticInput = {
  stage?: FailureDiagnosticStage;
  code?: string;
  reason?: string;
  attemptId?: string;
  commandId?: string;
};
export type HttpRequestContext = {
  readonly requestId: string;
  /** For route-handled failures that do not reach endpoint's catch. At most one record. */
  reportFailure(error: unknown, status: number, publicCode: string): void;
};
const stages = new Set<string>([
  'accept',
  'snapshot',
  'preflight',
  'send',
  'model',
  'response_store',
  'decode',
  'validate',
  'execute',
  'commit',
  'receipt',
  'projection',
]);
const gatewayStages = new Set(['request', 'response', 'parse', 'stream']);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function own(value: unknown, key: string): unknown {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
/** No message/stack/cause, getter execution or arbitrary string coercion. */
export function safeHttpFailureMetadata(error: unknown): Record<string, unknown> {
  const diagnostic = own(error, 'diagnostic');
  const classification = classifyAgentRejection(diagnostic ?? error);
  const result: Record<string, unknown> = {
    category: classification.category,
    ...(classification.code ? { failureCode: classification.code } : {}),
    ...(classification.reason ? { failureReason: classification.reason } : {}),
  };
  const stage = own(diagnostic, 'stage');
  if (typeof stage === 'string' && stages.has(stage)) result.failureStage = stage;
  for (const key of ['attemptId', 'commandId']) {
    const id = own(diagnostic, key);
    if (typeof id === 'string' && uuid.test(id)) result[key] = id;
  }
  const gatewayStage = own(error, 'stage');
  if (typeof gatewayStage === 'string' && gatewayStages.has(gatewayStage))
    result.gatewayStage = gatewayStage;
  const httpStatus = own(error, 'httpStatus');
  if (finite(httpStatus) && Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599)
    result.upstreamHttpStatus = httpStatus;
  const duration = own(error, 'durationMs');
  if (finite(duration)) result.gatewayDurationMs = Math.round(duration);
  return result;
}

export function createHttpRequestContext(
  requestId: string,
  started: number,
  write: (record: string) => void = (record) => console.warn(record),
  now: () => number = Date.now,
): HttpRequestContext {
  let recorded = false;
  return {
    requestId,
    reportFailure(error, status, publicCode) {
      if (recorded) return;
      recorded = true;
      // Diagnostics must never replace a business result, even when logging is unavailable.
      try {
        const code = ErrorCode.safeParse(publicCode);
        write(
          JSON.stringify({
            requestId,
            code: code.success ? code.data : 'UNAVAILABLE',
            status: Number.isInteger(status) && status >= 400 && status <= 599 ? status : 503,
            durationMs: Math.max(0, Math.round(now() - started)),
            ...safeHttpFailureMetadata(error),
          }),
        );
      } catch {
        /* The original response remains authoritative. */
      }
    },
  };
}
