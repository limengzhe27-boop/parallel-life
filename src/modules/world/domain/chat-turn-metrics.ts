export type ChatTurnErrorCategory =
  | 'none'
  | 'preflight'
  | 'busy'
  | 'version_conflict'
  | 'invalid_state'
  | 'upstream_model'
  | 'response_store'
  | 'decode'
  | 'commit'
  | 'unknown';

export type ChatTurnPhaseTimings = {
  /** 1. 用户发送到服务器接收 (ms, null when client timestamp header is absent) */
  clientSendToServerReceiveMs: number | null;
  /** 2. 上下文准备耗时 (ms) */
  contextPrepareMs: number;
  /** 3. 上游请求发出到首段内容 (ms) */
  upstreamFirstChunkMs: number;
  /** 4. 模型完整输出耗时 (ms) */
  modelTotalMs: number;
  /** 5. 响应持久化耗时 (ms) */
  responsePersistMs: number;
  /** 6. 解码与编译耗时 (ms) */
  decodeCompileMs: number;
  /** 响应保存与纯解析并行实际墙钟耗时 (ms) */
  persistAndDecodeWallMs: number;
  /** 7. 内核及事务提交耗时 (ms) */
  kernelCommitMs: number;
  /** 8. 提交后到前端实际显示 (ms) */
  postCommitToDisplayMs: number | null;
  /** 9. 第一条有意义的NPC消息出现时间 (ms) */
  firstMeaningfulReplyMs: number | null;
  /** 10a. 整轮结束时间 (ms) */
  fullTurnMs: number | null;
  /** 10b. 工具完成时间 (ms, 0 when no async tool/media outbox was triggered) */
  toolCompletionMs: number;
  /** 服务端整轮处理总耗时 (ms) */
  serverTotalMs: number;
};

export type ChatTurnTelemetryRecord = {
  worldId: string;
  actorId: string;
  commandId: string;
  eventId: string | null;
  worldVersionBefore: number | null;
  worldVersionAfter: number | null;
  serverReceivedAtEpochMs: number;
  timings: ChatTurnPhaseTimings;
  schemaBytes: number;
  inputBytes: number;
  outputBytes: number;
  queryCount: number;
  transactionCount: number;
  contextQueryCount: number;
  commitQueryCount: number;
  modelCallCount: number;
  cacheHits: number;
  replay: boolean;
  outcome: 'committed' | 'failed' | 'unknown';
  errorCategory: ChatTurnErrorCategory;
};

export type NumericDistributionSummary = {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  p50: number | null;
  /** Only populated when count >= 20 to avoid fabricating unstable P95 claims on small samples. */
  p95: number | null;
  p95SufficientSampleSize: boolean;
};

export type ChatTurnBenchmarkSummary = {
  sampleCount: number;
  succeededCount: number;
  failedCount: number;
  unknownCount: number;
  errorCounts: Record<ChatTurnErrorCategory, number>;
  contextPrepareMs: NumericDistributionSummary;
  upstreamFirstChunkMs: NumericDistributionSummary;
  modelTotalMs: NumericDistributionSummary;
  responsePersistMs: NumericDistributionSummary;
  decodeCompileMs: NumericDistributionSummary;
  persistAndDecodeWallMs: NumericDistributionSummary;
  kernelCommitMs: NumericDistributionSummary;
  postCommitToDisplayMs: NumericDistributionSummary;
  firstMeaningfulReplyMs: NumericDistributionSummary;
  fullTurnMs: NumericDistributionSummary;
  serverTotalMs: NumericDistributionSummary;
  queryCount: NumericDistributionSummary;
  transactionCount: NumericDistributionSummary;
  contextQueryCount: NumericDistributionSummary;
  schemaBytes: NumericDistributionSummary;
  inputBytes: NumericDistributionSummary;
  outputBytes: NumericDistributionSummary;
};

const GENERIC_PLACEHOLDER_PATTERNS = [
  /^正在输入[….。]*$/,
  /^对方正在输入[….。]*$/,
  /^稍等[….。!！]*$/,
  /^请稍等[….。!！]*$/,
  /^加载中[….。]*$/,
  /^\.+$/,
  /^…+$/,
];

/**
 * First network byte, typing animation, or generic "稍等" placeholder never counts
 * as the first meaningful NPC reply.
 */
export function isMeaningfulNpcReplyText(text: string | null | undefined): boolean {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  return !GENERIC_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function roundDurationMs(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100) / 100;
}

export function classifyChatTurnError(error: unknown, stage?: string): ChatTurnErrorCategory {
  if (!error) return 'none';
  if (stage === 'preflight') return 'preflight';
  if (stage === 'response_store') return 'response_store';
  if (stage === 'decode') return 'decode';
  if (stage === 'commit') return 'commit';
  if (stage === 'model') return 'upstream_model';
  const code =
    typeof error === 'object' && error !== null
      ? String(
          (error as { apiCode?: unknown; code?: unknown }).apiCode ??
            (error as { code?: unknown }).code ??
            '',
        )
      : '';
  if (code === 'BUSY' || code === 'ATTEMPT_PENDING') return 'busy';
  if (
    [
      'VERSION_CONFLICT',
      'AGENT_REVISION_CONFLICT',
      'ENGINE_EPOCH_CONFLICT',
      'ATTEMPT_STALE',
    ].includes(code)
  )
    return 'version_conflict';
  if (['NPC_AGENT_SNAPSHOT_LIMIT', 'NPC_AGENT_INVALID_SNAPSHOT'].includes(code)) return 'preflight';
  if (
    ['INVALID_STATE', 'WORLD_PAUSED', 'NPC_DELIVERY_DEFERRED', 'INPUT_SCOPE_FORBIDDEN'].includes(
      code,
    )
  )
    return 'invalid_state';
  if (['INVALID_AI_OUTPUT', 'INVALID_AGENT_PROPOSAL', 'ATTEMPT_INVALID'].includes(code))
    return 'decode';
  return 'unknown';
}

export function summarizeNumericSeries(values: readonly number[]): NumericDistributionSummary {
  const finite = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const count = finite.length;
  if (count === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      mean: null,
      p50: null,
      p95: null,
      p95SufficientSampleSize: false,
    };
  }
  const sum = finite.reduce((acc, v) => acc + v, 0);
  const percentile = (p: number) => {
    const idx = Math.min(count - 1, Math.max(0, Math.ceil(p * count) - 1));
    return roundDurationMs(finite[idx]!);
  };
  const sufficientForP95 = count >= 20;
  return {
    count,
    min: roundDurationMs(finite[0]!),
    max: roundDurationMs(finite[count - 1]!),
    mean: roundDurationMs(sum / count),
    p50: percentile(0.5),
    p95: sufficientForP95 ? percentile(0.95) : null,
    p95SufficientSampleSize: sufficientForP95,
  };
}

export function summarizeChatTurnSamples(
  samples: readonly ChatTurnTelemetryRecord[],
): ChatTurnBenchmarkSummary {
  const errorCounts: Record<ChatTurnErrorCategory, number> = {
    none: 0,
    preflight: 0,
    busy: 0,
    version_conflict: 0,
    invalid_state: 0,
    upstream_model: 0,
    response_store: 0,
    decode: 0,
    commit: 0,
    unknown: 0,
  };
  for (const sample of samples) {
    errorCounts[sample.errorCategory] = (errorCounts[sample.errorCategory] ?? 0) + 1;
  }
  const committed = samples.filter((s) => s.outcome === 'committed');
  const pick = (fn: (s: ChatTurnTelemetryRecord) => number | null) =>
    committed.map(fn).filter((v): v is number => v !== null && Number.isFinite(v));

  return {
    sampleCount: samples.length,
    succeededCount: committed.length,
    failedCount: samples.filter((s) => s.outcome === 'failed').length,
    unknownCount: samples.filter((s) => s.outcome === 'unknown').length,
    errorCounts,
    contextPrepareMs: summarizeNumericSeries(pick((s) => s.timings.contextPrepareMs)),
    upstreamFirstChunkMs: summarizeNumericSeries(pick((s) => s.timings.upstreamFirstChunkMs)),
    modelTotalMs: summarizeNumericSeries(pick((s) => s.timings.modelTotalMs)),
    responsePersistMs: summarizeNumericSeries(pick((s) => s.timings.responsePersistMs)),
    decodeCompileMs: summarizeNumericSeries(pick((s) => s.timings.decodeCompileMs)),
    persistAndDecodeWallMs: summarizeNumericSeries(pick((s) => s.timings.persistAndDecodeWallMs)),
    kernelCommitMs: summarizeNumericSeries(pick((s) => s.timings.kernelCommitMs)),
    postCommitToDisplayMs: summarizeNumericSeries(pick((s) => s.timings.postCommitToDisplayMs)),
    firstMeaningfulReplyMs: summarizeNumericSeries(pick((s) => s.timings.firstMeaningfulReplyMs)),
    fullTurnMs: summarizeNumericSeries(pick((s) => s.timings.fullTurnMs)),
    serverTotalMs: summarizeNumericSeries(pick((s) => s.timings.serverTotalMs)),
    queryCount: summarizeNumericSeries(pick((s) => s.queryCount)),
    transactionCount: summarizeNumericSeries(pick((s) => s.transactionCount)),
    contextQueryCount: summarizeNumericSeries(pick((s) => s.contextQueryCount)),
    schemaBytes: summarizeNumericSeries(pick((s) => s.schemaBytes)),
    inputBytes: summarizeNumericSeries(pick((s) => s.inputBytes)),
    outputBytes: summarizeNumericSeries(pick((s) => s.outputBytes)),
  };
}
