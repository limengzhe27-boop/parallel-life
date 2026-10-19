# 44-154-P7 Exclusive authored choice protocol

Owner codex-batch-lease-review-154-p7. Base 9feb2677, director-choice154-p7. Pending root integration/deployment.

Fresh director-wire-v7 has authoredChoices keyed exactly by immutable event refs. Each required key has one discriminated value: defer/reason OR consider/opportunities. Authored opportunities omit origin: server mechanically binds the key, then uses the fixed v6 grouping and original validation. Top-level opportunities are emergent only. No parallel events/mode decision fields exist. Schema requires every event key with additionalProperties false, uses shared $defs to avoid per-event opportunity grammar duplication, and allows only {} when no author event is eligible.

No opportunity/task/participation/world fact is invented. Empty consider, missing/unknown keys, mixed defer/consider fields, nested authored-origin injection, duplicate top-level authors, cross-bucket ID conflicts, total opportunity limit violations and original bootstrap/permission failures remain rejected. Old v1-v6 paths and v5/v6 namespaced paid raw meanings remain fixed; old contradictory paid raw is not repaired.

47 focused pure tests passed (Director model, single-choice, grouped and exclusive-author suites). TypeScript noEmit passed. No PG, commercial model, SQL or production operations. Root owns final gates, real PG and model validation, deployment.
