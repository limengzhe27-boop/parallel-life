# 44-158-L Media cancellation handoff

Owner: `codex-media-abort158-l`. Independent worktree based on `ee461d77`; integration and deployment remain with the root integrator.

## Problem and change

The task worker supplied an `AbortSignal`, but the media handler did not pass it through provider submission, polling, or download. A worker timeout could therefore leave a paid request in flight and record a misleading failure. The original media request, Outbox job, and task remain the only authoritative records; this change creates no parallel attempt or retry mechanism.

- Pass the optional signal through the original image/video pipeline and the Yibu and Replicate providers. A signal already aborted before submission sends no provider request.
- Once a submission might have reached a provider, aborted or uncertain transport results become `STATUS_UNKNOWN`. Preserve a provider task ID when a receipt was received. An explicit HTTP rejection or fully received malformed response remains a known failure.
- Propagate cancellation through status polling and asset download. Poll exhaustion after accepted submission is also unknown, since the provider may still finish.
- Record an uncertain result as `unknown` on `world_media_requests` and its original Outbox job. The handler then raises the existing `UPSTREAM_FAILED` worker code so the original task is marked `unknown`, with no automatic second purchase. A later task cannot resubmit an already-unknown request.

## Verification

- Focused adapter, pipeline, and new PostgreSQL cancellation tests: 24 passed. Existing adjacent media tests: 19 passed.
- `npm run check`: 3432 passed, 0 failed. `npm run typecheck` and `npm run check:boundaries` passed. `git diff --check` passed.
- The new PostgreSQL test verifies request and Outbox unknown state, preserved provider task ID, and no new provider call on replay. It uses the original queue status mapping rather than invoking a paid provider.
- `npm run build`: passed, including TypeScript and route generation.

## Limits and integration notes

No commercial provider request or live generated image was made in this worktree. The root integrator must verify its candidate build and production flow. This patch does not add a new executor for video or change the worker's zero-retry policy. A pre-submission cancellation may leave the original task `unknown` by the existing worker mapping, even though the provider call count is zero; it does not consume media spend.
