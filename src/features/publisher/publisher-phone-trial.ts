import type { PublisherWork } from '../../contracts/world-publisher.ts';
import type { PublicationWorldResult } from '../../contracts/publication-worlds.ts';

export type PublisherPhoneTrial = {
  trialId: string;
  workId: string;
  draftVersion: number;
  contentHash: string;
};
export function phoneTrialMatches(
  work: PublisherWork | null,
  trial: PublisherPhoneTrial | null | undefined,
) {
  return (
    !!work &&
    !!trial &&
    work.id === trial.workId &&
    work.draftVersion === trial.draftVersion &&
    work.draft.version === trial.draftVersion &&
    work.draft.contentHash === trial.contentHash
  );
}
/** The actual staff trial endpoint must acknowledge exactly the saved draft being opened. */
export function phoneTrialFromResult(
  work: PublisherWork,
  result: PublicationWorldResult,
): PublisherPhoneTrial {
  if (
    !result.trialId ||
    result.originKind !== 'trial' ||
    result.origin.workId !== work.id ||
    result.origin.draftVersion !== work.draftVersion ||
    work.draft.version !== work.draftVersion ||
    result.origin.contentHash !== work.draft.contentHash
  )
    throw Error('TRIAL_DRAFT_MISMATCH');
  return {
    trialId: result.trialId,
    workId: work.id,
    draftVersion: work.draftVersion,
    contentHash: work.draft.contentHash,
  };
}
export function phoneTrialUrl(trial: PublisherPhoneTrial, actorKey?: string) {
  const base = '/workbench/trials/' + encodeURIComponent(trial.trialId);
  return actorKey && /^[a-z][a-z0-9_]{0,31}$/.test(actorKey)
    ? base + '?' + new URLSearchParams({ view: 'wechat', actor: actorKey })
    : base;
}

export function phoneTrialMount(
  work: PublisherWork | null,
  trial: PublisherPhoneTrial | null,
  placement: 'inline' | 'drawer' | null,
) {
  const matched = phoneTrialMatches(work, trial) ? trial : null;
  return {
    inline: placement === 'inline' ? matched : null,
    drawer: placement === 'drawer' ? matched : null,
  };
}
