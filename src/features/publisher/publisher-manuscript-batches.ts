import { PublisherPreparationMaterialSchema } from '../../contracts/publisher-preparation.ts';
export type ManuscriptFile = { filename: string; content: string };
/** Partition whole documents without cutting, summarising or silently dropping their text. */
export function manuscriptBatches(
  files: ManuscriptFile[],
  currentContent: Record<string, unknown>,
) {
  const batches: ManuscriptFile[][] = [],
    oversized: ManuscriptFile[] = [];
  let batch: ManuscriptFile[] = [];
  const fits = (sources: ManuscriptFile[]) =>
    PublisherPreparationMaterialSchema.safeParse({ currentContent, sources, scope: 'characters' })
      .success;
  for (const file of files) {
    if (!fits([file])) {
      oversized.push(file);
      continue;
    }
    if (batch.length && !fits([...batch, file])) {
      batches.push(batch);
      batch = [];
    }
    batch.push(file);
  }
  if (batch.length) batches.push(batch);
  return { batches, oversized };
}
