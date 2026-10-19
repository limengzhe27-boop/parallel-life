# 44-154-P9 Explicit NPC focus delta

Owner codex-batch-lease-review-154-p9. Base a857527b, npc-focus154-p9. Pending root integration/deployment.

Fresh npc-wire-v9 replaces nullable focus with required focusChange: keep, clear, or set/value (original non-null Focus structure). Direct focus is rejected. Keep compiles to omitted focus delta, clear to explicit null, set to the declared original Focus; each then follows fixed v8 source-ref decoding and original v7/kernel validation. This is a transport distinction, not a quiet-state relaxation: quiet plus an actual clear/change still rejects, while keep preserves existing focus without changing state.

Previous v1-v8 paid raw interpretation is unchanged. In particular old v8 focus:null remains a real clear, so its prior quiet-with-existing-focus failure is not repaired. Nested set.value.questionSourceId uses the existing exact structural source mapping and rejects unknown refs. No helper change or additional source authority was needed. Model prompt and latest provider schema now require the explicit discriminator.

91 focused pure tests passed across NPC focus-change/source-reference/model/protocol/agenda-review/plan-wire suites; TypeScript noEmit passed. New tests cover quiet keep, explicit clear, set source mapping and channel validation, missing/contradictory discriminator rejection, old v8 failure protection and provider schema source grammar.

No PG/model/SQL/production operations. Root owns remaining PG, final gates, real-model verification and deployment.
