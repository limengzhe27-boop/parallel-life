import { classifyAgentRejection } from './agent-rejection-classification.ts';
export type AgentFailureStage =
  'preflight' | 'send' | 'model' | 'response_store' | 'decode' | 'commit';
export type AgentFailureDiagnostic = {
  stage: AgentFailureStage;
  code?: string;
  reason?: string;
  attemptId?: string;
  commandId?: string;
};
/** Adds bounded operational metadata, preserving the original exception and its lifecycle semantics. */
export function attachAgentFailure(
  error: unknown,
  stage: AgentFailureStage,
  identity?: { id: string; commandId: string },
  cause?: unknown,
) {
  if (!error || typeof error !== 'object') return error;
  try {
    const prior = Object.getOwnPropertyDescriptor(error, 'diagnostic')?.value as
      AgentFailureDiagnostic | undefined;
    const classified = classifyAgentRejection(cause ?? error);
    const diagnostic: AgentFailureDiagnostic = {
      ...(prior ?? {}),
      stage: prior?.stage ?? stage,
      ...(classified.code && !prior?.code ? { code: classified.code } : {}),
      ...(classified.reason && !prior?.reason ? { reason: classified.reason } : {}),
      ...(identity ? { attemptId: identity.id, commandId: identity.commandId } : {}),
    };
    Object.defineProperty(error, 'diagnostic', { value: diagnostic, configurable: true });
  } catch {
    /* Diagnostic failure never substitutes a business failure. */
  }
  return error;
}
