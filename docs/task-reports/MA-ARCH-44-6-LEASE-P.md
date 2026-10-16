# MA-ARCH-44-6-LEASE-P — leased app database facade

Status: frozen pending root acceptance. No production activation or full multi-Agent acceptance.

## Assignment

Agent `codex-ma44-lease-p`, auxiliary2 conversation `01a11a84-9572-7ab0-92fb-967f963dfc20`. Reuse `/Users/limengzhe/.codex/worktrees/publication-story-02/人生剧本`, branch `codex/leased-agent44`, base `4b8f4dc5` (root already merged player command integration). Root alone owns shared public contracts, kernel/finalizer, migration0073/0074, dispatcher and release.

Exactly three new files:

- `src/modules/world/infrastructure/leased-agent-database.ts`
- `tests/integration/leased-agent-database.test.ts`
- this report

No existing repository, public port, SQL migration, kernel or server source changed. No new database/table permission, production/model operation, browser or full build.

## Frozen interface / trust boundary

`withLeasedAgentDatabase(db: PostgresDatabase, lease: TaskLease): PostgresDatabase`

The facade exposes only `pool`, `transaction`, `close`. It is structurally compatible with the existing database type, reuses exactly `db.pool`, creates no connection pool and makes close a no-op. Only the original pool owner may close the pool.

**This is a trusted modular-monolith app adapter, not a SQL sandbox, new SQL worker authority or per-world RLS policy.** The server supplies an existing pl_app connection pool and an actually claimed task lease. An arbitrary callback or caller with direct pool access already has that server app authority. All AgentStore/Kernel work must use facade.transaction. The trusted runner/kernel must bind every native task input, source, target world/channel and action to the actual task; the facade cannot prevent a trusted SQL callback from deliberately targeting a different same-owner world. It does not provide remote code/database access to models or clients.

The captured lease is detached from later caller mutation; its world kind, identifiers and actual JSON input are validated. JSON-only values are copied without dropping undefined, functions, cycles, nonfinite numbers, class objects or sparse arrays. SQL JSONB equality compares the entire input, including nested values and array order; object key ordering is immaterial. Original input is never printed.

## Transaction protocol

Every transaction performs:

1. Require requested owner exactly equals captured lease.ownerId.
2. Enter original db.transaction, which starts the SQL transaction and sets transaction-local app.user_id.
3. Check actual current_user is a pl_app member and not a pl_worker member; require actual local identity equals owner. Worker cannot gain authority by forging app.user_id or supplying a real lease.
4. Lock actual tasks row **FOR UPDATE**. Require exact id, owner, world scope kind, scope ID, token, JSONB input, status running and lease_until greater than PostgreSQL clock_timestamp.
5. Lock actual owned world **FOR UPDATE**, then its engine control **FOR SHARE**; require a safe integer epoch at least2. No implicit epoch1 upgrade or control creation.
6. Invoke the trusted short SQL callback.
7. Recheck identity, actual task fields/token/input/expiry and epoch before return/commit. Post-status is running or succeeded only. Any failure throws LeaseLost and original transaction rolls back all callback writes. Callback exceptions propagate after rollback.

Root initially proposed task SHARE. Review identified same-lease task-lock upgrade risk during finalization when another transaction held task SHARE waiting for world UPDATE. Root explicitly approved direct task UPDATE then world UPDATE/control SHARE, implemented and tested. Concurrent same-lease transactions serialize before entering the callback; a duplicate after success cannot enter. External cancellation and renew wait for the short transaction and become visible to the next operation. Never hold this transaction over model/network work.

No app.agent commit attempt marker or player world-command authority is set. Actual NPC attempt/action/world commit authority still comes from the existing AgentStore/Kernel.

## Same-transaction terminal hook

Per root's latest explicit decision, callback may mark the already-running parent task succeeded. Task UPDATE prevents an external process from changing that row during the callback, and the postcheck still requires every identity/token/input/expiry/epoch field. **Facade success is not proof of NPC business success.** Root's kernel finalizer must verify the actual committed AgentAttempt, native accepted input/source, event, successful command, exact resultVersion and derived command ID `agent:${lease.id}:${actorId}`, then update the parent task in that same transaction. This batch does not implement or claim that finalizer binding.

An existing succeeded/failed/cancelled/unknown/queued task cannot enter a new callback. Unknown is neither retried nor reclassified by the facade. The terminal test uses an explicit SQL fixture and is not a fabricated model/Agent success.

## Focused verification

Real local PostgreSQL18.4 at55566, idle listener checked before start. Migration runner uses unchanged checksums through0072. All fixtures are local synthetic accounts/worlds/tasks; actual worker claimForOwner yields the lease. No model calls.

Final UPDATE-lock implementation:53/53 combined focused PG tests passed (new facade12, AgentRuntimeStore30, player UoW gate11), typecheck passed, module boundaries524 passed, diff check passed. Ignored log `.local/ma44-lease-pg.log`. No full build/model/production. Test coverage includes:

- Existing AgentRuntimeRepository reads through facade, exact shared pool, close no-op.
- Wrong owner/world/token/task ID/kind/full input rejected before callback; real JSON key reordering remains equivalent.
- Captured lease/input immune to caller mutation; non-JSON/cyclic data rejected.
- Database status/expiry/owner/world/epoch and changed persisted input are authoritative.
- Each separate AgentStore read rechecks lease; cancellation never retains authorization.
- Actual task lock blocks external cancellation during the short transaction; it applies after release.
- Concurrent same-lease finalization serializes; first commits and duplicate is denied without entering callback or deadlock.
- Callback error, expiration during callback, identity/epoch/input/status changes roll back writes.
- Same-transaction succeeded hook accepted; already-succeeded task cannot run again.
- Real worker role with real lease and forged app.user_id is rejected;0072 Agent tables still lack worker SELECT privilege.
- Pooled identities remain local across owners and facade lifetime.

## Integration next step

Root serially receives the three-file source and wires the actual leased app facade into channel runner/store/kernel. Root must retain callback/world/source binding and implement the strict same-SQL parent task finalizer before claiming completed group/scene/automatic progression. Full check/build/deployment/READY/public flow validation remain root's responsibility. This isolated local adapter test is not production activation or true NPC dialogue acceptance.
