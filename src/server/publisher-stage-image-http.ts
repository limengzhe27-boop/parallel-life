import 'server-only';
import { Id } from '../contracts/api.ts';
import { PublisherStageImageInputSchema } from '../contracts/publisher-stage-image.ts';
import {
  makePublisherStageImage,
  recoverPublisherStageImage,
  type StageImageMaterial,
  type StageImageExecution,
} from '../modules/settings/application/publisher-stage-image.ts';
import { PublisherStageImageRepository } from '../modules/settings/infrastructure/publisher-stage-image-repository.ts';
import { YibuMediaProviderAdapter } from '../modules/media/infrastructure/yibu-media-provider-adapter.ts';
import { removePortraitBackground } from '../modules/media/infrastructure/portrait-matting.ts';
import { publisherServices } from './publisher-services.ts';
import {
  getPublicationMediaRepository,
  getPublicationMediaStore,
  putGeneratedPublicationMedia,
} from './publisher-media-http.ts';
import {
  publisherEndpoint,
  publisherBody,
  publisherJson,
  PublisherHttpError,
} from './publisher-http.ts';
import sharp from 'sharp';
const executing = new Set<string>();
function requireLocal() {
  const origin = new URL(process.env.APP_ORIGIN || 'https://invalid.invalid');
  if (
    process.env.VERCEL ||
    !process.env.PRIVATE_ASSET_DIR ||
    !(
      ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) ||
      origin.hostname.endsWith('.localhost')
    )
  )
    throw new PublisherHttpError('UNAVAILABLE');
}
async function png(bytes: Buffer) {
  if (bytes.length > 15_000_000)
    throw Object.assign(new Error('INVALID_RESPONSE'), { code: 'INVALID_RESPONSE' });
  return sharp(bytes, { limitInputPixels: 16_000_000 }).rotate().png().toBuffer();
}
function execution(principal: string, workId: string): StageImageExecution {
  const repo = getPublicationMediaRepository(),
    store = getPublicationMediaStore();
  async function readLocal(key: string) {
    return store.readStored?.(key);
  }
  async function save(material: StageImageMaterial, bytes: Buffer) {
    const metadata = await sharp(bytes, { limitInputPixels: 16_000_000 }).metadata();
    const stats = await sharp(bytes).stats();
    if (!metadata.hasAlpha || stats.channels.at(-1)?.min !== 0 || !stats.channels.at(-1)?.max)
      throw Object.assign(new Error('Invalid portrait transparency'), {
        code: 'PORTRAIT_MATTING_FAILED',
      });
    if (!store.put) throw new PublisherHttpError('UNAVAILABLE');
    await store.put(material.storageKey, bytes);
    const image = await putGeneratedPublicationMedia(
      principal,
      workId,
      material.outputAssetId,
      bytes,
      'image/png',
    );
    return {
      assetId: image.assetId,
      kind: 'image' as const,
      mimeType: 'image/png' as const,
      byteLength: image.byteLength,
    };
  }
  async function fromSaved(material: StageImageMaterial) {
    const final = await readLocal(material.storageKey);
    if (final) return save(material, final);
    const raw = await readLocal(material.rawStorageKey);
    if (!raw) return null;
    const result = await removePortraitBackground(raw, AbortSignal.timeout(180000));
    return save(material, result);
  }
  return {
    async recover(material) {
      // Another HTTP poll never competes with a currently running paid request.
      if (executing.has(material.storageKey)) return null;
      executing.add(material.storageKey);
      try {
        return await fromSaved(material);
      } finally {
        executing.delete(material.storageKey);
      }
    },
    async produce(material) {
      executing.add(material.storageKey);
      try {
        const saved = await fromSaved(material);
        if (saved) return saved;
        const source = await repo.publisherAsset(principal, workId, material.sourceAssetId);
        if (!source.mime_type.startsWith('image/')) throw new PublisherHttpError('INVALID_INPUT');
        let bytes = await readLocal(source.storage_key);
        if (!bytes) {
          const url = await store.signRead(source.storage_key);
          const response = await fetch(url, {
            cache: 'no-store',
            signal: AbortSignal.timeout(15000),
            redirect: 'error',
          });
          if (!response.ok) throw new PublisherHttpError('UNAVAILABLE');
          if (Number(response.headers.get('content-length') || 0) > 10_000_000)
            throw new PublisherHttpError('CONTENT_TOO_LARGE');
          bytes = Buffer.from(await response.arrayBuffer());
        }
        const reference = await png(bytes);
        const adapter = new YibuMediaProviderAdapter({
          apiKey: process.env.YIBU_API_KEY,
          baseUrl: process.env.YIBU_BASE_URL,
          model: process.env.YIBU_IMAGE_MODEL,
          timeoutMs: 110000,
        });
        const result = await adapter.submitImage({
          deduplicationKey: material.outputAssetId,
          referenceImageBytes: reference,
          referenceImageMimeType: 'image/png',
          signal: AbortSignal.timeout(115000),
          builtPrompt: {
            ruleVersion: material.promptVersion,
            targetModel: 'flux-1.1-pro',
            aspectRatio: '3:4',
            outputFormat: 'webp',
            hasReferenceImage: true,
            prompt:
              'Create one natural photorealistic visual novel character from the reference person. Preserve the recognizable face, original age, gender, hairstyle, skin tone and opaque clothing. A relaxed standing pose, head to knees fully visible, front facing, arms natural, no props. Plain neutral background, even soft daylight, clear separation of hair and clothes from background. One person only. No text, no panel, no collage, no painted checkerboard. Do not sexualize, alter age, or invent a different identity. This is a reusable character sprite, not a story event or a selfie.',
          },
        });
        if (!result.outputBase64)
          throw Object.assign(new Error('Provider result unknown'), { code: 'STATUS_UNKNOWN' });
        const raw = await png(Buffer.from(result.outputBase64, 'base64'));
        if (!store.put) throw new PublisherHttpError('UNAVAILABLE');
        // Preserve the paid result before local processing. Matting/storage recovery never buys again.
        await store.put(material.rawStorageKey, raw);
        const cutout = await removePortraitBackground(raw, AbortSignal.timeout(180000));
        return save(material, cutout);
      } finally {
        executing.delete(material.storageKey);
      }
    },
  };
}
export function publisherStageImageRoute(request: Request, workId: string) {
  return publisherEndpoint(async () => {
    requireLocal();
    const s = publisherServices(request),
      principal = await s.http.authorize(request, request.method === 'POST', 'edit');
    if (!Id.safeParse(workId).success) throw new PublisherHttpError('INVALID_INPUT');
    const store = new PublisherStageImageRepository(s.database),
      run = execution(principal.id, workId);
    if (request.method === 'GET') {
      const id = new URL(request.url).searchParams.get('commandId');
      if (!Id.safeParse(id).success) throw new PublisherHttpError('INVALID_INPUT');
      return publisherJson(await recoverPublisherStageImage(store, run, principal.id, workId, id!));
    }
    const input = await publisherBody(request, PublisherStageImageInputSchema, 4096);
    return publisherJson(await makePublisherStageImage(store, run, principal.id, workId, input));
  });
}
