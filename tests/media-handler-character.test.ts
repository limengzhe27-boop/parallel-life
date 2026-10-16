import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaHandler } from '../src/modules/media/infrastructure/media-handler.ts';
import type { CharacterImageSynthesizer, GenerateImageParams } from '../src/modules/media/application/image-synthesizer.ts';

test('mediaHandler: NPC request without bound asset never leaks player portrait to synthesizer', async () => {
  let capturedSynthesizerParams: GenerateImageParams | null = null;

  const mockSynthesizer: CharacterImageSynthesizer = {
    generateAndCommit: async (params) => {
      capturedSynthesizerParams = params;
      return { assetId: 'mock-generated-asset-id' };
    },
  };

  const mockQueue: any = {
    read: async (lease: any, fn: any) => {
      const mockSql = {
        query: async (queryText: string, params: any[]) => {
          if (queryText.includes('FROM parallel_life.world_media_requests')) {
            return {
              rows: [
                {
                  document: {
                    targetActorId: 'actor-npc-1',
                    isPlayer: false,
                    prompt: 'NPC in tea shop',
                    title: 'NPC Photo',
                  },
                  world_id: 'world-1',
                  outbox_id: 'outbox-1',
                },
              ],
            };
          }
          if (queryText.includes('count(*)::int as count FROM parallel_life.assets')) {
            return { rows: [{ count: 1 }] };
          }
          if (queryText.includes('FROM parallel_life.world_person_bindings')) {
            // NPC has NO bound portrait asset
            return { rows: [] };
          }
          if (queryText.includes('FROM parallel_life.world_initial_snapshots')) {
            // Player portrait DOES exist!
            return { rows: [{ portrait_id: 'secret-player-portrait-asset-id' }] };
          }
          return { rows: [] };
        },
      };
      return fn(mockSql);
    },
    commit: async (lease: any, fn: any) => {
      const mockSql = { query: async () => ({ rows: [] }) };
      return fn(mockSql);
    },
  };

  const handler = mediaHandler(mockQueue, mockSynthesizer);

  const lease: any = {
    kind: 'media',
    scopeId: 'req-1',
    ownerId: 'owner-1',
  };

  await handler(lease);

  assert.ok(capturedSynthesizerParams, 'Synthesizer should be called');
  const params1 = capturedSynthesizerParams as unknown as GenerateImageParams;
  // CRITICAL SECURITY ASSERTION: referenceAssetId must be undefined!
  // It must NOT have received 'secret-player-portrait-asset-id'!
  assert.equal(params1.referenceAssetId, undefined);
  assert.equal(params1.prompt, 'NPC in tea shop');
});

test('mediaHandler: Player request explicitly retrieves player portrait', async () => {
  let capturedSynthesizerParams: GenerateImageParams | null = null;

  const mockSynthesizer: CharacterImageSynthesizer = {
    generateAndCommit: async (params) => {
      capturedSynthesizerParams = params;
      return { assetId: 'mock-player-generated-asset-id' };
    },
  };

  const mockQueue: any = {
    read: async (lease: any, fn: any) => {
      const mockSql = {
        query: async (queryText: string) => {
          if (queryText.includes('FROM parallel_life.world_media_requests')) {
            return {
              rows: [
                {
                  document: {
                    isPlayer: true,
                    prompt: 'Player selfie on vacation',
                    title: 'My Portrait',
                  },
                  world_id: 'world-1',
                  outbox_id: 'outbox-1',
                },
              ],
            };
          }
          if (queryText.includes('count(*)::int as count FROM parallel_life.assets')) {
            return { rows: [{ count: 0 }] };
          }
          if (queryText.includes('FROM parallel_life.world_initial_snapshots')) {
            return { rows: [{ portrait_id: 'authorized-player-portrait-id' }] };
          }
          return { rows: [] };
        },
      };
      return fn(mockSql);
    },
    commit: async (lease: any, fn: any) => {
      const mockSql = { query: async () => ({ rows: [] }) };
      return fn(mockSql);
    },
  };

  const handler = mediaHandler(mockQueue, mockSynthesizer);

  const lease: any = {
    kind: 'media',
    scopeId: 'req-2',
    ownerId: 'owner-1',
  };

  await handler(lease);

  assert.ok(capturedSynthesizerParams);
  const params2 = capturedSynthesizerParams as unknown as GenerateImageParams;
  assert.equal(params2.referenceAssetId, 'authorized-player-portrait-id');
});

test('mediaHandler: NPC request with authorized bound asset passes NPC referenceAssetId', async () => {
  let capturedSynthesizerParams: GenerateImageParams | null = null;

  const mockSynthesizer: CharacterImageSynthesizer = {
    generateAndCommit: async (params) => {
      capturedSynthesizerParams = params;
      return { assetId: 'mock-npc-generated-asset-id' };
    },
  };

  const mockQueue: any = {
    read: async (lease: any, fn: any) => {
      const mockSql = {
        query: async (queryText: string) => {
          if (queryText.includes('FROM parallel_life.world_media_requests')) {
            return {
              rows: [
                {
                  document: {
                    targetActorId: 'actor-npc-lin',
                    prompt: 'Lin at art gallery',
                    title: 'Lin Photo',
                  },
                  world_id: 'world-1',
                  outbox_id: 'outbox-1',
                },
              ],
            };
          }
          if (queryText.includes('count(*)::int as count FROM parallel_life.assets')) {
            return { rows: [{ count: 2 }] };
          }
          if (queryText.includes('FROM parallel_life.world_person_bindings')) {
            return {
              rows: [{ asset_id: 'authorized-lin-asset-id', status: 'ready' }],
            };
          }
          return { rows: [] };
        },
      };
      return fn(mockSql);
    },
    commit: async (lease: any, fn: any) => {
      const mockSql = { query: async () => ({ rows: [] }) };
      return fn(mockSql);
    },
  };

  const handler = mediaHandler(mockQueue, mockSynthesizer);

  const lease: any = {
    kind: 'media',
    scopeId: 'req-3',
    ownerId: 'owner-1',
  };

  await handler(lease);

  assert.ok(capturedSynthesizerParams);
  const params3 = capturedSynthesizerParams as unknown as GenerateImageParams;
  assert.equal(params3.referenceAssetId, 'authorized-lin-asset-id');
});
