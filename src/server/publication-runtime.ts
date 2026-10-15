import { createHash, randomUUID } from 'node:crypto';
import { compilePublicationGenesis } from '../modules/settings/infrastructure/publication-genesis.ts';
import type { PublicationWorldCompilerPort } from '../modules/settings/application/publication-world-ports.ts';
import type { PublicationReviewPort } from '../modules/settings/infrastructure/publication-repository.ts';
import { TaskError } from '../modules/tasks/infrastructure/task-repository.ts';
import { publicationArt } from '../contracts/publication-assets.ts';
import { PublishedWorldContentSchema } from '../contracts/published-world-content.ts';
function worldCompiler(characterTrial = false): PublicationWorldCompilerPort {
  return {
    prepare(input) {
      if (characterTrial && input.originKind !== 'trial') throw new TaskError('INVALID_STATE');
      const content = PublishedWorldContentSchema.parse(input.content);
      const compiled = compilePublicationGenesis({
        ...input,
        content,
        originKind: input.originKind === 'trial' ? 'trial' : 'published',
        newId: randomUUID,
        ...(characterTrial ? { privateCharacterDemo: true as const } : {}),
      });
      if (compiled.status !== 'compiled') throw new TaskError('INVALID_STATE');
      return {
        world: compiled.world,
        opening: compiled.opening,
        seed: {
          id: input.seedId,
          createdAt: new Date().toISOString(),
          source: { kind: compiled.seedMetadata.source, ...input.origin },
          identity: compiled.opening.identity,
          situation: compiled.opening.situation,
          setting: compiled.opening.setting,
          experienceNote: compiled.opening.experienceNote,
        },
      };
    },
  };
}
export const publicationWorldCompiler = worldCompiler();
/** Explicit trusted staff-demo adapter; never used by normal trial/review/player publication. */
export const publicationCharacterTrialCompiler = worldCompiler(true);
/** Evidence comes from persisted trial events, never initial scripted messages or browser flags. */
export function publicationReview(
  evidence: (
    workId: string,
    version: number,
    hash: string,
  ) => Promise<{ verified: boolean; receiptId: string | null }>,
): PublicationReviewPort {
  return {
    async review(input) {
      const content = PublishedWorldContentSchema.parse(input.content);
      const compiled = compilePublicationGenesis({
        content,
        originKind: 'trial',
        origin: {
          workId: input.workId,
          publicationVersion: 0,
          draftVersion: input.draftVersion,
          contentHash: input.contentHash,
        },
        worldId: randomUUID(),
        ownerId: randomUUID(),
        seedId: randomUUID(),
        newId: randomUUID,
      });
      const rawTrial = await evidence(input.workId, input.draftVersion, input.contentHash);
      const trial = {
        verified: rawTrial.verified && rawTrial.receiptId !== null,
        receiptId: rawTrial.verified ? rawTrial.receiptId : null,
      };
      return {
        reviewerVersion: 'publication_optional_trial_v3',
        runtimeCapabilities: new Set(compiled.status === 'compiled' ? compiled.capabilities : []),
        media: {
          verified: true,
          manifestHash: createHash('sha256')
            .update(
              input.content.media?.length
                ? JSON.stringify(
                    input.content.media
                      .map((m) => publicationArt(m, m.use as 'avatar' | 'cover')?.sha256 ?? m.key)
                      .sort(),
                  )
                : 'empty-publication-media-manifest-v1',
            )
            .digest('hex'),
        },
        // Publishing does not require a trial. This policy never fabricates evidence.
        trialRequired: false,
        trial,
      };
    },
  };
}
