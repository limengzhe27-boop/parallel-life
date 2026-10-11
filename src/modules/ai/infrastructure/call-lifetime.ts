/** One deadline covers headers and all body reads, even with a non-cooperative transport. */
export function callLifetime(timeoutMs: number, external?: AbortSignal) {
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new DOMException('Model deadline reached', 'TimeoutError')),
    timeoutMs,
  );
  return {
    signal: external ? AbortSignal.any([external, timeout.signal]) : timeout.signal,
    timedOut: () => timeout.signal.aborted,
    dispose: () => clearTimeout(timer),
  };
}

/** Observe late settlement without allowing a timed-out reply to become a result. */
export function abortable<T>(
  pending: Promise<T>,
  signal: AbortSignal,
  disposeLate?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let ended = false;
    const aborted = () => {
      if (ended) return;
      ended = true;
      signal.removeEventListener('abort', aborted);
      reject(signal.reason);
    };
    if (signal.aborted) aborted();
    else signal.addEventListener('abort', aborted, { once: true });
    pending.then(
      (value) => {
        if (ended) {
          try {
            disposeLate?.(value);
          } catch {
            // A late cleanup failure must not create an unhandled rejection.
          }
          return;
        }
        ended = true;
        signal.removeEventListener('abort', aborted);
        resolve(value);
      },
      (error) => {
        if (ended) return;
        ended = true;
        signal.removeEventListener('abort', aborted);
        reject(error);
      },
    );
  });
}

/** Cleanup must not wait on a broken upstream or expose its exception. */
export function cancelBody(body: ReadableStream<Uint8Array> | null) {
  try {
    if (body && !body.locked) void body.cancel().catch(() => {});
  } catch {
    // Cancellation is best effort; caller still reports the original failure.
  }
}

export function closeReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    void reader.cancel().catch(() => {});
  } catch {
    // No cleanup failure may replace the safe original outcome.
  }
  try {
    reader.releaseLock();
  } catch {
    // Preserve the original outcome even if a transport has already released its lock.
  }
}
