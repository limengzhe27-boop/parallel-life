# 44-199 Scheduler scope

Baseline: `51be078f`. Worktree `.local/worktrees/scheduler199`, agent `scheduler199`. No production writes or model calls.

## Changes

- `services.ts`: remove duplicate single-actor proactive service; reuse the existing configured agent advance service (defaults 3 actors / 6 model calls / 8 steps / 45 seconds; running calls are not aborted at the boundary).
- `scheduler-repository.ts` and services SQL: request two worlds, 30-minute per-world background spacing, existing ten-minute lease.
- `0109_proactive_claim_scope.sql`: incrementally replace only the existing claim function; no tables, columns, new status or scoring. Remove six lease-row global daily gate and broad actor/director pending/unknown exclusions. Retain owner/world joining, epoch, paused/deleted/trial exclusion, advisory lock, lease, order and grants. Application actor/resource fences remain authoritative.
- `run-proactive-scheduler.ts`: claim two, execute concurrently, then re-claim; at most 50 worlds and no fresh claim after 240 seconds. A failed world does not stop others. No upfront leasing of the entire backlog; no new service/queue.

## Evidence

Dedicated PostgreSQL 55659; all migrations through 0109 applied locally.

- `proactive-scheduler199.test.ts`: 100 due worlds, two ticks of 50, no duplicates, subsequent claim zero; 29 minutes not due / 31 minutes due, overlapping claims return that world only once; scheduler cannot SELECT worlds. 1/1 passed, 147–335ms measured drain time. The execution callback represents two actor executions per world, 200 simulated executions total. **This is real SQL plus a controlled executor, not 100 real NPC model/transaction runs or model latency evidence.**
- Existing service integration unknown test now also calls actual background SQL after A enters unknown: world is claimed, B executes, A stays unknown with one paid-adapter invocation. This specific test passed (~1.1s).
- Entire legacy `npc-agent-advance-service.test.ts`: 18 total, 5 pass / 13 fail, including existing UNKNOWN_SOURCE / actor_local source expectations. Not claiming full file green; no unrelated fixtures changed. Only the unknown isolation test received assertions.
- Pure proactive scheduler 3/3 passed (including time-boundary without aborting running work); boundaries passed. Typecheck running at handoff; integrated check/build belongs to root.

## Capacity and outstanding work

Root verified production cron `*/30 * * * *`, not 30 seconds; GitHub backup is every 15 minutes. At 30-minute primary frequency a tick limited to 50 cannot cover 100 worlds within one interval. Root owns deploying a one-minute trigger using the same pg_cron job; no second scheduler is introduced.

50 is a hard tick maximum, not real-model capacity. With two concurrent worlds, 45-second world batches yield approximately 10 worlds per four-minute start window; running model calls may exceed the batch start boundary. Real model duration and overlapping cron/provider ceilings determine actual coverage. Single-world limits remain 3 actors / 6 calls / 8 steps / 45 seconds unless existing environment overrides them. Six calls per world is an upper bound, not compulsory spending; quiet/no candidates need not buy calls. 100-world full-model capacity, hour-level spend, and five-minute user narrative quality remain unverified.

Runtime failures are counted separately; `messages` retains existing `played` aggregate semantics and is not evidence of visible message delivery. Claims do not alter unknown statuses or retry paid requests. Production migration, full integrated check/build, actual existing-world verification and deployment belong to root; this branch must not deploy independently.
