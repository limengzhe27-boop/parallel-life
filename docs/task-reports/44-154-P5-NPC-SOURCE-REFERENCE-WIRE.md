# 44-154-P5 NPC source-reference wire

Owner: codex-batch-lease-review-154-p5. Base: 1815b380. Independent worktree: npc-source-ref154-p5. Status: pending root integration.

## Delivered

- Fresh NPC output is npc-wire-v8. Snapshot source order creates source:1… handles; the mapping stays server-side. All structural sourceId/sourceIds/basisSourceIds/questionSourceId fields decode exactly to immutable authorized IDs before the fixed v7 parser and original kernel. Unknown handles and raw IDs reject; no fuzzy correction or permission widening.
- Latest dynamic schema projects source enums including shared authorized-basis definitions and question/current-input bindings. No repeated full hashes are required from the model.
- Model payload projection happens only at serialization. Internal trimming/protected-source accounting remains canonical, and budgets use actual serialized input. Sources directory, observations, structured system-trigger JSON, authored persona publicPremise.identity.sourceId, and selfAgendaContext.definitionSourceId use short handles. Final current-speaker instructions use the same inputSourceRef. Player text and ordinary quoted prose remain byte-for-byte unchanged.
- Unknown ancillary input pointers are marked unavailable rather than granted aliases. The alias catalog exposes only short ref/kind, never the canonical mapping or database pointers.
- describeSuppliedContext decodes supplied observation refs back to canonical IDs before matching immutable source hashes. Existing scene/group acknowledgement identities are preserved.
- v8 alone accepts goals:null as an empty goal-update delta even with visible existing goals. It creates no goal and does not change terminal-state protections. Previous v1–v7 paths and paid raw interpretations remain fixed; old v7 null with editable goals still rejects.

## Necessary verification

86/86 focused pure tests passed across npc-source-reference, npc-agent-model, npc-model-protocol, npc-agenda-review-wire, npc-plan-wire. TypeScript noEmit passed. Regression covers exact alias validation, source-array duplicate preservation, v8 missing-input mechanical anchor through v7, raw/hash typo rejection, old-v7 rejection/protection, nullable delta, player text preservation, structured persona/system projection and canonical group-inbox manifest hash.

No real model calls, production mutation, SQL, broad check/build or PostgreSQL tests performed by this worker. Root owns integration, PostgreSQL, final gates, candidate real-model verification and deployment. Existing goal/plan IDs remain canonical; shortening those references is deliberately outside this source-only delivery.

## Scope

Changed NPC protocol/model; new npc-source-reference helper and test; latest assertion adaptation in npc-agent-model, npc-model-protocol, npc-agenda-review-wire, npc-plan-wire tests. No kernel, author, SQL or runtime scheduler changes.
