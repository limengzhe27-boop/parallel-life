# MA-ARCH-44-2-PLAYER-P — actual player command integration

Status: frozen, pending root acceptance. Root alone owns kernel/public contracts/dispatch/integration/release. This is not end-to-end multi-Agent acceptance.

## Assignment and scope

- Agent `codex-ma44-player-p`, auxiliary2 conversation `01a11a84-9572-7ab0-92fb-967f963dfc20`.
- Worktree `/Users/limengzhe/.codex/worktrees/publication-story-02/人生剧本`, branch `codex/player-world44`, base `a8e19311` (root merged the player-only UoW gate).
- Exclusive existing files: `postgres-world-repository.ts` (only `respondToInvitation` and `saveNote`), `group-repository.ts`, `scene-repository.ts`, `space-repository.ts`, `story-wait-repository.ts`, `appointment-wait-repository.ts`, `clock-repository.ts`, `clock-activity-repository.ts`, all in `src/modules/world/infrastructure/`.
- New `tests/integration/player-world-commands.test.ts` and this report. No new kernel, public contract, migration0072/store, migration0073, application scheduler, dispatcher, production or model edits.
- Source search found no actual player world branch/delete implementation. Discovery branch labels and publication-work deletion are different operations. Those gate whitelist kinds remain unsupported by actual world writers; no invented implementation.

## Changes

Original command/receipt replay returns before current epoch/version authorization. New writes call `authorizeWorldCommandInTransaction` using the existing SQL client/transaction; world/event/command/projections/receipt/outbox behavior remains owned by the existing repository.

|Actual player operation|Gate|Details|
|---|---|---|
|Save/edit note|note_save|The optimistic expectedVersion is the note version. Gate uses the already locked current world version; neither is confused with the other. Immutable old note receipt remains original after editing and engine switch.|
|Respond to calendar invitation|invitation_respond|Original invitation receipt before gate; existing consent/time/domain checks retained.|
|Travel / explicit verified old-space establishment|space_travel|Replay first, shared advisory lock and idle checks retained, gate in same transaction.|
|Create group / change group membership|group_membership|Gate only inside actual player mutate entry. Shared persistGroupEvent is not given player authorization.|
|Send group message|group_input|Real source event and durable queued TaskView remain. No fake reply, placeholder failure or new engine field.|
|Enter appointment scene / enter place scene|scene_enter|Only actual player enters; NPCs are not inferred from contact links. In epoch2, do not seed scene matters using old world progress.|
|Record scene input|scene_input|Original receipt first; classification/source/presence/actual opening checks retained. Private thought retains no task; ordinary input keeps durable queued task.|
|Scene navigation / explicit leave|scene_enter|Original receipt first; actual player event/experience update. Existing leave cancellation behavior retained.|
|Explicit story wait / appointment wait|story_wait|Retain important appointment/opening/authored date guards; atomic world time/clock/receipt. Epoch2 never invokes the legacy publicationGoalContexts progress interpreter, which can write old progress.|
|Pause/speed/clock activity lease|clock_control|Locked world version used; no public command ID contract change. Existing activity sequence replay returns first. No player gate is added to NPC/old clock commit helpers.|

Epoch1 retains the existing narration/scheduling, authored progress interpretation and scene matter initialization. The additional travel visibility restriction is an intentional privacy fix requested by root: a departure observer must be a current actor actually present in the matching physical scene, joined no later than current world version. Contact/family relations do not establish physical presence. Fact text contains the departure place and explicitly no destination; source event already stores the actual departedAt separately from arrival time. Existing Fact contract has no observation timestamps; richer occurrence/learned metadata belongs to root's0073, untouched here.

## Root-coordinated dispatch / limitations

Root explicitly chose to retain the existing real player event + queued durable task + TaskView/input shape for group and scene. Root must route/deny by authoritative DB epoch before any old Planner/model invocation in every server/worker entry. This batch alone must not activate production epoch2, nor claim new group/scene agents are ready.

A new scene currently records player presence only. The first real time_place entry and NPC presence formerly came from sceneTaskHandler/commitSceneProposal. Public input correctly refuses before that actual opening; this batch does not bypass the check or invent an opening. A locally synthesized legitimate epoch1 opening followed by engine switch proves that the existing scene accepts epoch2 player input. Root's new scene runner must replace the opening before end-to-end acceptance.

Shared NPC result/event helpers remain un-gated. Old group actor messages fail app-role RLS; even an otherwise valid empty old group result fails the epoch world fence. A valid old scene result and old direct time writer fail the epoch fence; failed transactions leave world events and projections unchanged. Worker cannot borrow the actual player note path. Global legacy clock/attempt entry prevention remains root's dispatcher/migration responsibility, not authority granted by this patch.

## Verification

- New actual player suite: 11/11 including parent, real owner-RLS PG on55566. Zero model calls. Covers note edit/replay across switch, calendar confirmation/wait, travel/replay/no contact-location leak, pause/resume/activity replay, explicit short wait, group membership/input durability and old NPC rejection, honest unopened scene refusal/leave, already opened scene input and old NPC rejection, actual witness departure, worker denial.
- `npm run typecheck`: passed after final test additions.
- `npm run check:boundaries`: passed522 files.
- `git diff --check`: passed.
- Local PG migration runner verifies all applied migrations; no SQL changed.
- Final combined targeted PG:83 tests,82 passed,0 failed,1 explicitly disabled real-model opt-in skip (`GROUP_MODEL_EVAL=0`); includes player command/gate/group/scene/space/clock activity/appointment wait/story wait. Log `.local/ma44-player-pg.log` (ignored). No full build or models.

### Baseline failure audit

Initial existing-suite run:66 tests,61pass,4fail,1real-model skip. One failure was a harness port mismatch (clock activity defaults55503); rerunning with `CLOCK_ACTIVITY_TEST_PORT=55566` passes its10 tests. Three failures in `tests/integration/world-clock.test.ts` remain on the unchanged `a8e19311` base too. To verify, all eight owned source files were temporarily loaded byte-for-byte from HEAD, only that test ran, and a finally block restored every owned working file. Base result0/3 matches modified result0/3:

1. Expected one unresolved invitation follow-up, actual0.
2. Expected concurrent retry two rejected promises, actual fulfilled/rejected.
3. `World time cannot run backwards` in late player result.

No old director/application/domain/test source was changed to disguise these failures. Root was notified with exact evidence and owns the pending clock/scheduler architecture correction. Full check/build/deploy/model/public QA are intentionally not run by P in this batch, per root's serial integration assignment.

## Next owner

Root serial cherry-pick and review, dispatch every queued group/scene task by DB epoch before old models, implement actual new scene opening/actor runner, resolve baseline old director tests in the shared architecture, full check/build/migrations/READY/public validation. Production worlds and user authored drafts are untouched by this local fixture work.
