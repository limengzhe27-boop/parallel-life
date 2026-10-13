import type { PublisherPreparationMaterial, PublisherPreparationOutput, PublisherPreparationInput, PublisherPreparationRecord } from '../../../contracts/publisher-preparation.ts';

export interface PublisherPreparationPlanner {
  propose(input: PublisherPreparationMaterial, signal?: AbortSignal): Promise<PublisherPreparationOutput>;
}
export interface PublisherPreparationStore {
  begin(principalId: string, workId: string, input: PublisherPreparationInput): Promise<{record: PublisherPreparationRecord; claimed: boolean}>;
  read(principalId: string, workId: string, commandId?: string): Promise<PublisherPreparationRecord | null>;
  finish(principalId: string, workId: string, commandId: string, outcome: {
    status: 'succeeded'|'failed'|'unknown';
    result: PublisherPreparationOutput|null;
    errorCode: PublisherPreparationRecord['errorCode'];
  }): Promise<PublisherPreparationRecord>;
}

/** A persisted admission precedes the single paid call. Reading/replaying never restarts it. */
export async function preparePublisherManuscript(
  store: PublisherPreparationStore, planner: PublisherPreparationPlanner,
  principalId: string, workId: string, input: PublisherPreparationInput,
): Promise<PublisherPreparationRecord> {
  const admission = await store.begin(principalId, workId, input);
  if (!admission.claimed) return admission.record;
  let result: PublisherPreparationOutput;
  try {
    result = await planner.propose(admission.record.material, AbortSignal.timeout(110000));
  } catch (error) {
    const code = (error as {code?: string})?.code;
    const invalid = ['INVALID_RESPONSE','TRUNCATED','INVALID_INPUT'].includes(code ?? '');
    return store.finish(principalId, workId, input.commandId, {
      status: invalid ? 'failed' : 'unknown', result: null,
      errorCode: invalid ? 'INVALID_RESPONSE' : code === 'TIMEOUT' || code === 'CANCELLED' ? 'TIMEOUT' : 'UPSTREAM_FAILED',
    });
  }
  // A storage failure must not reclassify a paid success or repeat the model request.
  return store.finish(principalId, workId, input.commandId, {status:'succeeded',result,errorCode:null});
}
