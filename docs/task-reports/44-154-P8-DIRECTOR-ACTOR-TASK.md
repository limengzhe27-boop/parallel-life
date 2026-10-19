# 44-154-P8 Single authored opportunity with keyed actor tasks

Owner codex-batch-lease-review-154-p8. Base 4be2ab55, director-task154-p8. Pending root integration/deployment.

Fresh director-wire-v8 authoredChoices[eventRef] is defer/reason OR consider/opportunity (one object, never an array). The authored opportunity contains title, description, playerImpact, places, activity, actorTasks and optional actorTopics. No model-authored id, origin, actors or stagingIntents is accepted. actorTasks requires every immutable actor ref exactly once: {task} selects that actor, null does not. At least one actor must be selected. Server mechanically derives authored_event_N local identity, actor list and each selected actor's future_task, then passes through the fixed v7/v6 validation pipeline. No tasks, attitudes, agreement or results are invented.

Provider grammar uses exact event/actor object keys and shared author-opportunity definitions. Original top-level emergent opportunities retain their contract and original source/boundary/budget validation. Legacy v1–v7 decoding remains fixed, with v5/v6/v7 explicit attempt-ID namespacing. Old duplicate-actor paid v7 raw still rejects rather than being deduplicated.

52 focused pure tests passed across model/single-choice/grouped/exclusive-author/new actor-task suites; TypeScript noEmit passed. Tests cover nonnull selection, null exclusion, deterministic server IDs/tasks, immutable input, rejection of all-null/missing/foreign actors and redundant id/actors/tasks/arrays, and fixed v7 namespacing/old invalid behavior.

No PG/model/SQL/production operations. Root owns integration, final gates, real-model verification and deployment.
