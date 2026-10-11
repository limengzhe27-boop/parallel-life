import { DomainError } from './errors.ts';

export type MatterSpan = 'near_term' | 'pursuit';

export type MatterStatus =
  'not_started' | 'in_progress' | 'blocked' | 'completed' | 'abandoned' | 'superseded';

export type MatterAssertion = 'player_statement' | 'world_verified' | 'actor_statement';

export type MatterSource =
  | { kind: 'genesis'; seedId: string; openingKey?: string }
  | { kind: 'preset'; presetId: string; version: number; matterKey: string }
  | { kind: 'director_proposal'; eventId: string; eventVersion: number; at: string }
  | { kind: 'actor_proposal'; actorId: string; eventId: string; eventVersion: number; at: string }
  | { kind: 'scene_action'; sceneId: string; actionId: string; at: string };

export type MatterEvidence =
  | {
      kind: 'director_progression';
      reason: string;
      eventId: string;
      eventVersion: number;
      at: string;
    }
  | {
      kind: 'user_report';
      quote: string;
      outcome: 'reported_done' | 'blocked' | 'abandoned';
      eventId: string;
      eventVersion: number;
      at: string;
    }
  | {
      kind: 'scene_action';
      sceneId: string;
      actionId: string;
      outcome: 'succeeded' | 'failed' | 'partial';
      eventId: string;
      eventVersion: number;
      at: string;
    }
  | { kind: 'scene_steps'; sceneId: string; actionId: string; ruleVersion: 'r17-delivery-v1'; eventId: string; eventVersion: number; at: string }
  | { kind: 'world_event'; reason: string; eventId: string; eventVersion: number; at: string };

/** Bounded runtime-owned evidence. Quotes are validated against saved inputs/results. */
export type SceneStepProposal = { matterId: string; stepId: string; inputQuote: string; observationQuote: string; receiverId?: string };
export type SceneNpcActionProposal = { matterId: string; actorId: string; kind: 'receive_r17' | 'inspect_r17'; quote: string };
export type SceneStepEvidence = {
  stepId: string; performer: 'player' | 'actor'; actorId?: string; receiverId?: string;
  sceneId: string; actionId: string; inputEventId: string; inputVersion: number;
  eventId: string; eventVersion: number; at: string; inputQuote: string;
  observationQuote: string; witnessActorIds: string[];
};
export type SceneStepProgress = { ruleVersion: 'r17-delivery-v1'; steps: SceneStepEvidence[] };

export type WorldMatter = {
  id: string;
  worldId: string;
  span: MatterSpan;
  title: string;
  description: string;
  status: MatterStatus;
  assertion: MatterAssertion;
  visibility: 'player_visible' | 'hidden';
  prerequisites?: string[];
  relatedActorIds?: string[];
  relatedPlaceId?: string;
  relatedInvitationId?: string;
  source: MatterSource;
  evidence?: MatterEvidence;
  version: number;
  createdAt: string;
  updatedAt: string;
  rewardClaimed?: boolean;
  stepProgress?: SceneStepProgress;
  pursuitProgress?: {
    milestones: {
      matterId: string;
      title: string;
      eventId: string;
      eventVersion: number;
      at: string;
    }[];
    nextOpportunityIds: string[];
  };
  opportunity?: { pursuitId: string; triggerMatterId: string; key: string };
};

export const validMatterTransitions: Record<MatterStatus, readonly MatterStatus[]> = {
  not_started: ['in_progress', 'abandoned', 'superseded'],
  in_progress: ['blocked', 'completed', 'abandoned', 'superseded'],
  blocked: ['in_progress', 'completed', 'abandoned', 'superseded'],
  completed: [],
  abandoned: [],
  superseded: [],
};

export type CreateMatterInput = {
  id: string;
  worldId: string;
  span: MatterSpan;
  title: string;
  description: string;
  status?: MatterStatus;
  assertion?: MatterAssertion;
  visibility?: 'player_visible' | 'hidden';
  prerequisites?: string[];
  relatedActorIds?: string[];
  relatedPlaceId?: string;
  relatedInvitationId?: string;
  source: MatterSource;
  evidence?: MatterEvidence;
  now: string;
};

export function createWorldMatter(input: CreateMatterInput): WorldMatter {
  const title = input.title.trim();
  const description = input.description.trim();
  if (!title || title.length > 100) {
    throw new DomainError(
      'INVALID_PROPOSAL',
      'INVALID_MATTER: Title must be between 1 and 100 characters',
    );
  }
  if (!description || description.length > 500) {
    throw new DomainError(
      'INVALID_PROPOSAL',
      'INVALID_MATTER: Description must be between 1 and 500 characters',
    );
  }

  const status = input.status ?? 'in_progress';
  if (!['not_started', 'in_progress'].includes(status)) {
    throw new DomainError(
      'INVALID_PROPOSAL',
      'INVALID_MATTER: Initial status must be not_started or in_progress',
    );
  }

  const assertion = input.assertion ?? 'actor_statement';

  return {
    id: input.id,
    worldId: input.worldId,
    span: input.span,
    title,
    description,
    status,
    assertion,
    visibility: input.visibility ?? 'player_visible',
    ...(input.prerequisites?.length ? { prerequisites: input.prerequisites } : {}),
    ...(input.relatedActorIds?.length ? { relatedActorIds: input.relatedActorIds } : {}),
    ...(input.relatedPlaceId ? { relatedPlaceId: input.relatedPlaceId } : {}),
    ...(input.relatedInvitationId ? { relatedInvitationId: input.relatedInvitationId } : {}),
    source: input.source,
    ...(input.evidence ? { evidence: input.evidence } : {}),
    version: 1,
    createdAt: input.now,
    updatedAt: input.now,
    rewardClaimed: false,
  };
}

export type TransitionMatterInput = {
  status: MatterStatus;
  evidence: MatterEvidence;
  assertion?: MatterAssertion;
  now: string;
  allMatters?: readonly WorldMatter[];
};

export function transitionWorldMatter(
  matter: WorldMatter,
  update: TransitionMatterInput,
): WorldMatter {
  if (
    matter.status === 'completed' ||
    matter.status === 'abandoned' ||
    matter.status === 'superseded'
  ) {
    throw new DomainError(
      'INVALID_PROPOSAL',
      'MATTER_TERMINAL: Matter is in terminal state and cannot be altered',
    );
  }

  const allowed = validMatterTransitions[matter.status];
  if (!allowed.includes(update.status)) {
    throw new DomainError(
      'INVALID_PROPOSAL',
      'INVALID_MATTER_TRANSITION: Cannot transition matter status',
    );
  }

  // Prerequisites check: if transitioning to in_progress or completed, all prerequisites must be completed
  if (
    (update.status === 'in_progress' || update.status === 'completed') &&
    matter.prerequisites?.length
  ) {
    const uncompleted = matter.prerequisites.filter((preId) => {
      const pre = (update.allMatters ?? []).find((m) => m.id === preId);
      return !pre || pre.status !== 'completed';
    });
    if (uncompleted.length > 0) {
      throw new DomainError(
        'INVALID_PROPOSAL',
        `PREREQUISITE_NOT_MET: Prerequisites [${uncompleted.join(', ')}] are not completed`,
      );
    }
  }

  let finalAssertion: MatterAssertion = update.assertion ?? matter.assertion;

  if (
    update.status === 'completed' &&
    update.evidence.kind === 'scene_action' &&
    update.evidence.outcome !== 'succeeded'
  )
    throw new DomainError(
      'INVALID_PROPOSAL',
      'Failed or partial scene actions cannot complete a matter',
    );

  // Strict truthfulness rule:
  // Player self-report (user_report) can never assert world_verified!
  if (update.evidence.kind === 'user_report') {
    if (update.assertion === 'world_verified') {
      throw new DomainError(
        'INVALID_PROPOSAL',
        'INVALID_MATTER_ASSERTION: User report cannot establish world-verified truth',
      );
    }
    finalAssertion = 'player_statement';
  } else if (update.evidence.kind === 'scene_action' && update.evidence.outcome === 'succeeded') {
    finalAssertion = 'world_verified';
  } else if (
    update.evidence.kind === 'world_event' ||
    update.evidence.kind === 'director_progression'
  ) {
    finalAssertion = 'world_verified';
  }

  return {
    ...matter,
    status: update.status,
    assertion: finalAssertion,
    evidence: update.evidence,
    version: matter.version + 1,
    updatedAt: update.now,
  };
}

export function claimMatterReward(matter: WorldMatter, now: string): WorldMatter {
  if (
    matter.status !== 'completed' ||
    matter.assertion !== 'world_verified' ||
    !matter.evidence ||
    matter.evidence.kind === 'user_report' ||
    (matter.evidence.kind === 'scene_action' && matter.evidence.outcome !== 'succeeded')
  ) {
    throw new DomainError(
      'INVALID_PROPOSAL',
      'MATTER_NOT_COMPLETED: Cannot claim reward for uncompleted matter',
    );
  }
  if (matter.rewardClaimed) {
    throw new DomainError(
      'INVALID_PROPOSAL',
      'REWARD_ALREADY_CLAIMED: Reward for this matter has already been claimed',
    );
  }
  return {
    ...matter,
    rewardClaimed: true,
    version: matter.version + 1,
    updatedAt: now,
  };
}
