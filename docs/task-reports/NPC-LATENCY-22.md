# NPC-LATENCY-22 · shared reply latency, local rollout

2026-11-02; root-latency22 integration; baseline a8d8386b. Latest user requires local 3218/3219, no production deployment. No story-specific branches, memory changes, SQL, business fields or rewritten history.

## Diagnosis and rejected experiments

Same stored real snapshot, actual grok-4.3 gateway SSE (not a mock):

| Transport | First content chunk | First complete statement | Total | Decode |
|---|---:|---:|---:|---|
| Existing default | 17.238s | 19.456s | 19.899s | pass |
| Explicit low | 16.653s | 19.560s | 20.217s | pass |
| json_object + same schema in input | 21.145s | 22.010s | 24.535s | pass |
| Explicit none | 2.729s | 5.778s | 6.539s | pass |

Only none adopted for the verified **local grok-4.3 configuration**. No inference that other models support it. Earlier grok-4.7 rejection did not establish grok-4.3 behavior. Default/low/none all returned changes → executions → protocol → statements despite the submitted schema and prompt ordering statements first. json_object changed order but worsened latency; strict schema retained. No unknown call retried.

The stream parser already emits a complete statement immediately; persistence precedes HTTP delivery. Main observed wait is before upstream content. Do not call first upstream chunk a user-visible reply or claim JSON property order is guaranteed.

## Changes

- `createTextModel`: explicit optional `YIBU_NPC_REASONING_EFFORT`, validated by the existing adapter, affects NPC role only. Director, generic calls and scene model unchanged. Both complete/stream use the same role configuration, web and workers reuse it. Blank preserves prior defaults. `.env.example` documents it.
- Three ignored local env files set none with a grok-4.3 guard; no credentials committed/printed. No new runtime fallback or retry.
- NPC v83: omit consideration instructions when no opportunity exists; delete unused model-facing outputSchemaHash and duplicate planNextStepKinds (which wrongly included closed). Immutable snapshot/request hashes remain server-side.
- Provider schema omits only first-level changes properties fixed to null. Existing partial decoder treats omission and null identically; legacy paid responses remain readable. Nested action grammar, opportunity decisions, semantic interpretation, capability/source checks remain.
- First statement parsed and first committed segment delivered are timed in content-free server logs. Browser User Timing retains bounded first-reply-received/turn-complete measures with command ID, without additional requests. Receiving/applying a segment is not a measured browser paint.
- latency22_review owned three protocol tests in independent worktree; ae447d2 integrated as 35ca1771. No overlap with root files.

## Actual validation

1. check: 4164/4164; boundaries/typecheck passed. Build passed.
2. Real PostgreSQL `chat-latency-stage2`: 1/1, preserves early text/media and final handling. Dedicated schema tests 57/57 including null/omission equivalence and rejection of forged opportunity/review/foreign goal.
3. Updated same-snapshot real streaming, all decoded by original parser:
   - original: first chunk3.408s, first statement6.171s, total6.953s;
   - topic change: 2.607s /6.351s /8.114s, did not return to work;
   - photo request: 2.717s /7.704s /7.714s, preparation text + media.generate_image with phone/front-camera selfie. This is action-intent validation, not a newly generated/delivered image.
4. Original local cloned 渣男体验 `2fb97a4a-7282-4d75-8a5c-67faf44a3188`, actual authenticated HTTP message route, real model and DB:
   - 刘胜男 command5dec13d7-3a43-4305-8869-a4c8874fc24f: parsed5.932s; committed/delivered6.005s; HTTP receiver first segment6.036s, total7.767s, completed3/3.
   - 青青 commandbd66b267-4dfd-4670-a4a0-ced554debc05: first received6.405s, total7.352s, completed2/2.
   - Subsequent world GET returned all five assistant messages exactly once. Two normal test inputs were appended through the real route; original contents/progress retained. No manual storyline/message inserts.
5. 3218/3219 health200, build restarted; PIDs6310/6311, queue6312/proactive6313, local clone unchanged. Stored worker exclusions410tasks/251outbox retained.

Evidence (ignored, private): `.local/latency22/` baseline/low/json-object/none.json, verification.json, route-result/qingqing-result, route/web logs, check-final/build/integration logs and runtime-pids.json. No secrets/raw private payload in tracked report.

## Remaining / honest limits

- Browser paint measurement not completed: Ego required upgrade (previously authorized; upgraded), fresh Chrome session had different owner and correctly could not open original world. No ownership bypass/new world. Actual HTTP persisted-delivery validation is complete; it does not prove browser paint time. User can use existing logged-in tab and new performance measures.
- Above is a small sample, not P50/P95 or guaranteed 3–5s. First real committed reply still about6s. Schema-first property order leaves 2–5s between upstream content and full dialogue. No unsupported alternate envelope adopted.
- One old-input replay still proposed an inadequately grounded tomorrow08:30 arrangement. This batch does not claim long-term persona/decision quality fixed; actual two route turns did respect casual conversation. Faster inference must continue to be checked on event/complex-choice samples and other worlds.
- Long-term proactive scheduling is not proven. Restart logs show original2fb no_candidates and another world COMMAND_CONFLICT; retain PROACTIVE-ROOT-15 for root-cause follow-up, no forced messages/repeated model calls.
- Additional proposed current-input source/quote auto-binding and large schema changes were not implemented: no measured need justifies expanding this batch. Memory untouched.
- No production deployment, no GitHub push, no new image generation this batch. Runtime processes and a build are not proof that all gameplay is complete.
