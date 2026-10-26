import type { UploadedSceneImage } from './publisher-place-image.ts';
type Row = Record<string, unknown>;
const record = (value: unknown): value is Row =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function actorsIn(content: Row, actorKey: string) {
  if (!Array.isArray(content.actors) || content.actors.some((actor) => !record(actor)))
    throw new Error('原有人物资料需要核对，已保留原稿。');
  const actors = content.actors as Row[];
  const matches = actors.filter((actor) => actor.key === actorKey);
  if (matches.length !== 1 || !record(matches[0]!.publicCard))
    throw new Error('未找到这个人物，请刷新后重试。');
  return actors;
}
/** One optional asset reference; never modifies the avatar or removes the previous asset. */
export function attachActorImage(content: Row, actorKey: string, upload: UploadedSceneImage): Row {
  const actors = actorsIn(content, actorKey);
  if (upload.kind !== 'image' || !uuid.test(upload.assetId))
    throw new Error('图片上传未完成，请重试。');
  return {
    ...content,
    actors: actors.map((actor) =>
      actor.key === actorKey
        ? {
            ...actor,
            publicCard: { ...(actor.publicCard as Row), stageImage: { assetId: upload.assetId } },
          }
        : actor,
    ),
  };
}
/** Detach the reference only. Pinned publications may continue using the old image. */
export function detachActorImage(content: Row, actorKey: string): Row {
  const actors = actorsIn(content, actorKey);
  return {
    ...content,
    actors: actors.map((actor) => {
      if (actor.key !== actorKey) return actor;
      const card = { ...(actor.publicCard as Row) };
      delete card.stageImage;
      return { ...actor, publicCard: card };
    }),
  };
}
export function actorStageImageId(content: Row, actorKey: string): string | undefined {
  const actors = Array.isArray(content.actors) ? content.actors : [];
  const actor = actors.find((item) => record(item) && item.key === actorKey);
  const card = record(actor) && record(actor.publicCard) ? actor.publicCard : undefined;
  const stageImage = card && record(card.stageImage) ? card.stageImage : undefined;
  return typeof stageImage?.assetId === 'string' && uuid.test(stageImage.assetId)
    ? stageImage.assetId
    : undefined;
}
