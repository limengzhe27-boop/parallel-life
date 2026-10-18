# 44-158-A: trial runtime asset readability

Owner: codex-opening-fix-runtime158a. Integrator: root.
Base: 7a44992c. Branch: codex/trial-runtime-assets158-a.
Worktree: /Users/limengzhe/.codex/worktrees/trial-runtime-assets158-a/人生剧本

## Defect and change

The staff-only trial phone reused player-cookie /api/v1/assets links for generated chat photos and the album. Existing trial /world/media reads authored publication assets only, so that endpoint must not be used as a fallback for generated runtime assets.

worldAppData now accepts an optional fifth runtimeAssetUrlFor(worldId, assetId, revision) callback. WorldPhoneApp and its surface forward it; PublisherTrial supplies /api/v1/publisher/trials/:trialId/world/assets/:assetId?revision=N. Generated/runtime album and chat photos use this callback. The fourth mediaUrlFor callback remains exclusively authored attachments. Default player URLs and behavior are unchanged.

publisherTrialRoute adds only one GET branch after its original staff authorization and exact trial binding lookup. The new helper passes that bound owner/world plus exact ID/revision to the existing AssetRepository.readForWorld. There is no broader asset read, publication fallback, secret-bearing redirect or model execution. Valid magic bytes determine the response MIME, and invalid non-media is refused. Responses are private/no-store with nosniff and same-origin resource policy.

## Checks and remaining integration

- 16 focused world-app-data and runtime-asset tests passed: player/default URLs, separate authored/runtime paths, revisions, pending media without fabricated URLs, exact reader scope, denied access propagation and binary MIME/security headers.
- TypeScript noEmit, Prettier and git diff --check passed.
- No commercial calls, production writes, schema changes, local PostgreSQL work or deployment.
- Root owns unified PostgreSQL authorization regression, check/build, deployment and reading the already generated synthetic asset without regenerating it. Tests here do not claim a completed browser/model acceptance.
