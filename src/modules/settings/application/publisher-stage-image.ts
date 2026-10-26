import type {
  PublisherStageImageInput,
  PublisherStageImageRecord,
} from '../../../contracts/publisher-stage-image.ts';
export type StageImageMaterial = {
  kind: 'actor_stage_image';
  actorKey: string;
  sourceAssetId: string;
  outputAssetId: string;
  storageKey: string;
  rawStorageKey: string;
  promptVersion: string;
};
export type StageImageOperation = {
  record: PublisherStageImageRecord;
  material: StageImageMaterial;
};
export interface PublisherStageImageStore {
  begin(
    principal: string,
    workId: string,
    input: PublisherStageImageInput,
  ): Promise<StageImageOperation & { claimed: boolean }>;
  read(principal: string, workId: string, commandId: string): Promise<StageImageOperation | null>;
  finish(
    principal: string,
    workId: string,
    commandId: string,
    status: 'succeeded' | 'failed' | 'unknown',
    image: PublisherStageImageRecord['image'],
    errorCode: string | null,
  ): Promise<StageImageOperation>;
}
export interface StageImageExecution {
  /** Returns a previously saved candidate or null; never purchases a generation. */
  recover(material: StageImageMaterial): Promise<PublisherStageImageRecord['image']>;
  produce(material: StageImageMaterial): Promise<NonNullable<PublisherStageImageRecord['image']>>;
}
/** One durable author operation, one image purchase. Raw bytes and matting can resume separately. */
export async function makePublisherStageImage(
  store: PublisherStageImageStore,
  execution: StageImageExecution,
  principal: string,
  workId: string,
  input: PublisherStageImageInput,
) {
  const op = await store.begin(principal, workId, input);
  if (!op.claimed)
    return recoverPublisherStageImage(store, execution, principal, workId, input.commandId);
  let image: NonNullable<PublisherStageImageRecord['image']>;
  try {
    image = await execution.produce(op.material);
  } catch (error) {
    const code = (error as { code?: string }).code;
    const known = [
      'INVALID_RESPONSE',
      'INVALID_INPUT',
      'PORTRAIT_MATTING_FAILED',
      'PORTRAIT_MATTING_BUSY',
      'PORTRAIT_MATTING_UNAVAILABLE',
      'INVALID_PORTRAIT_IMAGE',
      'REFERENCE_IMAGE_UNAVAILABLE',
    ].includes(code ?? '');
    return (
      await store.finish(
        principal,
        workId,
        input.commandId,
        known ? 'failed' : 'unknown',
        null,
        known ? 'INVALID_RESPONSE' : code === 'TIMEOUT' ? 'TIMEOUT' : 'UPSTREAM_FAILED',
      )
    ).record;
  }
  // A database failure after paid success must propagate, never turn into a second purchase.
  return (await store.finish(principal, workId, input.commandId, 'succeeded', image, null)).record;
}
export async function recoverPublisherStageImage(
  store: PublisherStageImageStore,
  execution: StageImageExecution,
  principal: string,
  workId: string,
  commandId: string,
): Promise<PublisherStageImageRecord> {
  const op = await store.read(principal, workId, commandId);
  if (!op) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  if (op.record.image) return op.record;
  const image = await execution.recover(op.material);
  if (!image) return op.record;
  if (op.record.status === 'running')
    return (await store.finish(principal, workId, commandId, 'succeeded', image, null)).record;
  // The existing preparation guard makes terminal states immutable. A recovered ready asset
  // can still be offered honestly without rewriting unknown into a fabricated success.
  return { ...op.record, image };
}
