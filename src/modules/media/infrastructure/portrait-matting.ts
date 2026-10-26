import path from 'node:path';
import sharp, { type OutputInfo } from 'sharp';
import type { PortraitMatting } from '../application/portrait-matting.ts';

export const PORTRAIT_MATTING_MODEL = 'Xenova/modnet';
export const PORTRAIT_MATTING_REVISION = 'fa2fa546052fba4c08921230a26cc69a333fca12';
const MAX_BYTES = 10_000_000;
const MAX_PIXELS = 25_000_000;
const MAX_PENDING = 4;
type Segmenter = Awaited<ReturnType<typeof loadSegmenter>>;
let segmenter: Promise<Segmenter> | undefined;
let pending = 0;
let tail: Promise<unknown> = Promise.resolve();

function failure(code: string) {
  return Object.assign(new Error(code), { code });
}
function active(signal?: AbortSignal) {
  if (signal?.aborted) throw failure('CANCELLED');
}
/** A request abort can discard its output, but never starts another inference while ONNX is active. */
async function serialized<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  active(signal);
  if (pending >= MAX_PENDING) throw failure('PORTRAIT_MATTING_BUSY');
  pending++;
  const result = tail.then(async () => {
    try {
      active(signal);
      return await run();
    } finally {
      pending--;
    }
  });
  tail = result.catch(() => undefined);
  if (!signal) return result;
  let rejectAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(failure('CANCELLED'));
    signal.addEventListener('abort', rejectAbort, { once: true });
    if (signal.aborted) rejectAbort();
  });
  try {
    return await Promise.race([result, aborted]);
  } finally {
    if (rejectAbort) signal.removeEventListener('abort', rejectAbort);
  }
}

async function loadSegmenter() {
  // Deliberately import only after an opaque preparation request, never at app/chat startup.
  const { pipeline } = await import('@huggingface/transformers');
  return pipeline('background-removal', PORTRAIT_MATTING_MODEL, {
    revision: PORTRAIT_MATTING_REVISION,
    dtype: 'fp32',
    device: 'cpu',
    cache_dir: path.resolve(process.cwd(), '.local/model-cache/portrait-matting'),
    session_options: {
      intraOpNumThreads: 1,
      interOpNumThreads: 1,
      executionMode: 'sequential',
    },
  });
}

/** Reject empty, all-transparent or essentially opaque mattes instead of claiming a cutout. */
function alphaRange(data: Uint8Array | Uint8ClampedArray, channels: number) {
  let transparent = 0,
    visible = 0;
  const pixels = data.length / channels;
  if (channels !== 4 || !Number.isInteger(pixels) || pixels < 1)
    return { transparent: false, visible: false };
  for (let index = 3; index < data.length; index += channels) {
    if (data[index]! <= 8) transparent++;
    if (data[index]! >= 247) visible++;
  }
  return { transparent: transparent / pixels >= 0.005, visible: visible / pixels >= 0.01 };
}

/** All person pixels remain on this machine. The only network fetch is the pinned public ONNX model. */
export class LocalPortraitMatting implements PortraitMatting {
  async removePortraitBackground(bytes: Buffer, signal?: AbortSignal): Promise<Buffer> {
    return serialized(async () => {
      active(signal);
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES)
        throw failure('INVALID_PORTRAIT_IMAGE');
      let decoded: { data: Buffer; info: OutputInfo };
      try {
        const input = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'warning' });
        const metadata = await input.metadata();
        if (
          !['jpeg', 'png', 'webp'].includes(metadata.format ?? '') ||
          (metadata.pages ?? 1) !== 1 ||
          (metadata.width ?? 0) < 32 ||
          (metadata.height ?? 0) < 32
        )
          throw failure('INVALID_PORTRAIT_IMAGE');
        decoded = await input
          .rotate()
          .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
      } catch {
        throw failure('INVALID_PORTRAIT_IMAGE');
      }
      active(signal);
      const existing = alphaRange(decoded.data, decoded.info.channels);
      if (!existing.visible) throw failure('EMPTY_PORTRAIT_IMAGE');
      if (existing.transparent) {
        return sharp(decoded.data, {
          raw: { width: decoded.info.width, height: decoded.info.height, channels: 4 },
        })
          .png()
          .toBuffer();
      }
      segmenter ??= loadSegmenter().catch((error) => {
        segmenter = undefined;
        throw error;
      });
      let remove: Segmenter;
      try {
        remove = await segmenter;
      } catch {
        throw failure('PORTRAIT_MATTING_UNAVAILABLE');
      }
      active(signal);
      const { RawImage } = await import('@huggingface/transformers');
      const source = new RawImage(
        new Uint8ClampedArray(decoded.data),
        decoded.info.width,
        decoded.info.height,
        4,
      );
      let cutout: Awaited<ReturnType<Segmenter>>;
      try {
        cutout = await remove(source);
      } catch {
        throw failure('PORTRAIT_MATTING_FAILED');
      }
      active(signal);
      if (Array.isArray(cutout) || !cutout || cutout.channels !== 4)
        throw failure('INVALID_PORTRAIT_MATTE');
      const final = alphaRange(cutout.data, cutout.channels);
      if (!final.visible || !final.transparent) throw failure('INVALID_PORTRAIT_MATTE');
      return sharp(Buffer.from(cutout.data), {
        raw: { width: cutout.width, height: cutout.height, channels: 4 },
      })
        .png()
        .toBuffer();
    }, signal);
  }
}
const local = new LocalPortraitMatting();
export function removePortraitBackground(bytes: Buffer, signal?: AbortSignal): Promise<Buffer> {
  return local.removePortraitBackground(bytes, signal);
}
