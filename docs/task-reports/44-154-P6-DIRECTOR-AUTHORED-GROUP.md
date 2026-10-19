# 44-154-P6 Director authored multi-NPC opportunity grouping

Owner: codex-batch-lease-review-154-p6. Base 9440f7b3, independent director-group154-p6 worktree. Pending root integration and deployment.

## Delivery

Fresh director-wire-v6 allows two independently addressed opportunities for the same authored event to become one canonical shared opportunity. Grouping requires identical activity and place sets and disjoint actors. Every original item must have unique actors/places and exactly one self-contained future_task per participant. Actor topics, if supplied, must cover precisely that item's participants before grouping; canonical topic ownership and hashes remain subject to existing validation. Duplicate IDs, crossed tasks, repeated participants, incompatible activity/places, contradictory defer/consider, invalid author qualifications and bootstrap origin bypasses still reject.

Only original title/description/playerImpact text is concatenated, within existing bounds. Oversized compositions reject rather than truncate or invent connective text. All staging tasks and actor-topic selections are retained intact. Canonical identity uses the first stable local opportunity ID under the existing attempt namespace. Grouping does not create actions, world facts, player agreement, participation or event completion.

Old v1–v5 wire decoding is unchanged, including v5 duplicate-author rejection and its original namespaced IDs. The new v6 conversion alone groups before deriving the original v4 canonical assessment. Schema and fresh prompt identify v6; runtime prompt version is v17-grouped-authored-cast.

## Information boundary review

actor-episode-intent-repository builds only the addressed actor's director_future_task from that actor's stagingIntents entry. It does not put shared title/description/playerImpact or other participants' tasks into NPC observations. Episode dispatch input contains request identity/activity rather than shared description. Lifecycle/player-manifest context carries IDs, choices and state, not combined prose. No NPC context authorization was widened by this change.

## Verification

43/43 focused pure tests across director-agent-model, director-single-choice-wire and new director-grouped-opportunity-wire passed. TypeScript noEmit passed. Coverage includes one shared canonical opportunity/two intact tasks, same-attempt stable identity and input immutability, author assessment uniqueness, actor-topic ownership, conflicting activity/place/cast/task/ID/defer rejection, oversized metadata refusal, old v5 refusal and latest quiet semantics.

No PostgreSQL, real model, production, SQL or broad check/build operations by this worker. Root owns PG, final gates, real-model verification and deployment.
