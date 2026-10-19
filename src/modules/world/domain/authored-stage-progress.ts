import type { AuthoredAgentMaterialCatalog } from './authored-agent-material.ts';
import type {
  AuthoredEventEligibilityInput,
  AuthoredNodeProgress,
} from './authored-event-eligibility.ts';
import { worldDateTimeInput } from './display-time.ts';

export class AuthoredStageProgressError extends Error {
  readonly code = 'INVALID_AUTHORED_STAGE_PROGRESS';
  constructor() {
    super('INVALID_AUTHORED_STAGE_PROGRESS');
  }
}

/**
 * Read-side derivation from authenticated whole-event results, not a new stage fact store.
 * Each selected witness retains its actual source ID/time/version. The loader must authenticate it.
 */
export function deriveAuthoredStageProgress(
  catalog: AuthoredAgentMaterialCatalog,
  nodeProgress: readonly AuthoredNodeProgress[],
): AuthoredEventEligibilityInput['stageProgress'] {
  const fail = (): never => {
    throw new AuthoredStageProgressError();
  };
  const { world, source } = catalog;
  if (!source) return nodeProgress.length ? fail() : [];
  for (const proof of nodeProgress) {
    const nodes = catalog.materials.filter((m) => m.node.key === proof.nodeKey);
    if (
      proof.worldId !== world.worldId ||
      proof.engineEpoch !== world.engineEpoch ||
      !Number.isSafeInteger(proof.worldVersion) ||
      proof.worldVersion < 1 ||
      proof.worldVersion > world.worldVersion ||
      proof.sourceHash !== source.sourceHash ||
      typeof proof.sourceId !== 'string' ||
      !proof.sourceId.trim() ||
      !worldDateTimeInput(proof.at) ||
      nodes.length !== 1 ||
      proof.nodeHash !== nodes[0]!.ref.nodeHash ||
      !['presented', 'resolved'].includes(proof.kind) ||
      (proof.kind === 'resolved' &&
        !['committed', 'declined', 'skipped', 'expired'].includes(proof.outcome))
    )
      fail();
  }
  const result: AuthoredEventEligibilityInput['stageProgress'] = [];
  const stages = catalog.timeline?.stages ?? [];
  for (const stage of stages) {
    const rule = stage.completion;
    if (!rule || stages.filter((s) => s.key === stage.key).length !== 1) continue;
    if (
      !['all', 'any'].includes(rule.mode) ||
      !rule.criteria.length ||
      new Set(rule.criteria.map((c) => c.nodeKey)).size !== rule.criteria.length
    )
      continue;
    let invalid = false;
    const matches = rule.criteria.map((criterion) => {
      const nodes = catalog.materials.filter((m) => m.node.key === criterion.nodeKey);
      const material = nodes[0];
      const whole = material?.node.direction?.progress?.completion;
      if (
        nodes.length !== 1 ||
        !material ||
        material.unresolvedRefs.length ||
        material.node.timeline?.stageKey !== stage.key ||
        criterion.outcomes.length !== 1 ||
        criterion.outcomes[0] !== 'committed' ||
        !whole ||
        whole.scope !== 'invitation_response' ||
        !['all', 'any'].includes(whole.mode) ||
        !whole.criteria.length ||
        whole.criteria.some(
          (c) => c.kind !== 'invitation_response' || !['accepted', 'declined'].includes(c.response),
        )
      ) {
        invalid = true;
        return null;
      }
      const terminal = nodeProgress.filter(
        (p) => p.nodeKey === criterion.nodeKey && p.kind === 'resolved',
      );
      if (terminal.some((p) => p.kind === 'resolved' && p.outcome !== 'committed')) return null;
      // Choose the earliest immutable actual proof, so duplicates or later unrelated work cannot
      // reset an already satisfied stage's causal identity.
      return (
        terminal
          .filter((p) => p.kind === 'resolved' && p.outcome === 'committed')
          .sort(
            (a, b) =>
              a.worldVersion - b.worldVersion ||
              (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0),
          )[0] ?? null
      );
    });
    if (invalid || (rule.mode === 'all' ? matches.some((p) => !p) : matches.every((p) => !p)))
      continue;
    const selected = rule.mode === 'all' ? matches : [matches.find((p) => !!p)!];
    for (const p of selected) {
      if (!p) continue;
      result.push({
        worldId: p.worldId,
        engineEpoch: p.engineEpoch,
        worldVersion: p.worldVersion,
        sourceId: p.sourceId,
        sourceHash: p.sourceHash,
        at: p.at,
        stageKey: stage.key,
        status: 'resolved',
      });
    }
  }
  return result;
}
