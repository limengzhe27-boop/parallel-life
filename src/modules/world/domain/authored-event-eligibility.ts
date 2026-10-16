import {
  authoredMaterialCanonicalJson,
  type AuthoredAgentMaterial,
  type AuthoredAgentMaterialCatalog,
  type AuthoredMaterialPrerequisite,
  type AuthoredMaterialRef,
  type AuthoredMaterialScope,
} from './authored-agent-material.ts';
import { worldDateTimeInput } from './display-time.ts';

/** The loader authenticates these against persisted facts, not AI proposals or message counts. */
export type AuthoredEligibilityEvidence = AuthoredMaterialScope & {
  sourceId: string;
  sourceHash: string;
  at: string;
};
export type AuthoredNodeOutcome = 'committed' | 'declined' | 'skipped' | 'expired';
export type AuthoredNodeProgress = AuthoredEligibilityEvidence &
  (
    | { kind: 'presented'; nodeKey: string; nodeHash: string }
    | { kind: 'resolved'; nodeKey: string; nodeHash: string; outcome: AuthoredNodeOutcome }
  );
export type AuthoredEventEligibilityInput = {
  catalog: AuthoredAgentMaterialCatalog;
  storyAt: string;
  playerPlaceId: string | null;
  playerPositionProof: AuthoredEligibilityEvidence | null;
  historyFacts: (AuthoredEligibilityEvidence & { factKey: string })[];
  nodeProgress: AuthoredNodeProgress[];
  stageProgress: (AuthoredEligibilityEvidence & { stageKey: string; status: 'resolved' })[];
};
export type AuthoredEligibilityReason =
  | 'unresolved_ref'
  | 'invalid_time'
  | 'history_fact_missing'
  | 'node_not_presented'
  | 'node_not_committed'
  | 'node_not_resolved'
  | 'outcome_mismatch'
  | 'player_position_missing'
  | 'place_binding_missing'
  | 'at_place_not_met'
  | 'not_before'
  | 'window_not_open'
  | 'window_expired'
  | 'stage_dependency'
  | 'condition_not_met'
  | 'excluded_by_resolution'
  | 'mutually_exclusive'
  | 'already_presented'
  | 'already_resolved'
  | 'proof_conflict';
export type AuthoredEventEligibility = {
  ref: AuthoredMaterialRef;
  status: 'eligible' | 'blocked' | 'expired' | 'already_presented';
  reasons: AuthoredEligibilityReason[];
  basisSourceIds: string[];
  qualificationKey: string;
};
export class AuthoredEligibilityError extends Error {
  readonly code = 'INVALID_AUTHORED_ELIGIBILITY_INPUT';
  constructor() {
    super('INVALID_AUTHORED_ELIGIBILITY_INPUT');
  }
}
const fail = (): never => {
  throw new AuthoredEligibilityError();
};
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const hashPattern = /^[a-f0-9]{64}$/;
const outcomes: AuthoredNodeOutcome[] = ['committed', 'declined', 'skipped', 'expired'];
// Immutable author ISO strings may carry more precision than the runtime's
// millisecond clock. Normalize the comparison only; do not rewrite manuscript hashes.
const instant = (s: string): number | null => {
  if (typeof s !== 'string') return null;
  const normalized = s.replace(/(\.\d{3})\d+(?=Z$|[+-]\d{2}:\d{2}$)/, '$1');
  return worldDateTimeInput(normalized) ? Date.parse(normalized) : null;
};
const unique = <T>(values: T[]): T[] => [...new Set(values)];
type Check = {
  ok: boolean;
  reasons: AuthoredEligibilityReason[];
  basis: AuthoredEligibilityEvidence[];
  cause: unknown;
};
const check = (
  ok: boolean,
  reasons: AuthoredEligibilityReason[],
  cause: unknown,
  basis: AuthoredEligibilityEvidence[] = [],
): Check => ({ ok, reasons, cause, basis });

/**
 * Eligibility is a director consideration, never an instruction to perform or resolve an event.
 * Only explicit predicates are executable. Prose, venue metadata and stage order are not predicates.
 */
export function evaluateAuthoredEventEligibility(
  input: AuthoredEventEligibilityInput,
  digest: (canonical: string) => string,
): AuthoredEventEligibility[] {
  const { catalog, storyAt } = input;
  const now = instant(storyAt);
  const world = catalog.world;
  const fingerprint = (v: unknown): string => {
    const result = digest(authoredMaterialCanonicalJson(v));
    return typeof result === 'string' && hashPattern.test(result) ? result : fail();
  };
  if (
    now === null ||
    catalog.scope !== 'director_only' ||
    !text(world.worldId) ||
    !Number.isSafeInteger(world.engineEpoch) ||
    world.engineEpoch < 2 ||
    !Number.isSafeInteger(world.worldVersion) ||
    world.worldVersion < 0 ||
    (input.playerPlaceId !== null && !text(input.playerPlaceId))
  )
    fail();
  if (!catalog.source) {
    if (
      catalog.materials.length ||
      input.historyFacts.length ||
      input.nodeProgress.length ||
      input.stageProgress.length ||
      input.playerPositionProof
    )
      fail();
    return [];
  }
  const source = catalog.source;
  if (
    source.worldId !== world.worldId ||
    source.sourceScope !== 'bound_publication_story_source' ||
    !hashPattern.test(source.sourceHash)
  )
    fail();
  for (const m of catalog.materials)
    if (
      m.scope !== 'director_only' ||
      m.ref.nodeKey !== m.node.key ||
      authoredMaterialCanonicalJson(m.ref.source) !== authoredMaterialCanonicalJson(source) ||
      fingerprint(m.node) !== m.ref.nodeHash
    )
      fail();
  const nodes = (key: string) => catalog.materials.filter((m) => m.node.key === key);
  const stages = (key: string) => catalog.timeline?.stages.filter((s) => s.key === key) ?? [];
  const validateProof = (p: AuthoredEligibilityEvidence) => {
    const at = instant(p.at);
    if (
      !text(p.sourceId) ||
      p.worldId !== world.worldId ||
      p.engineEpoch !== world.engineEpoch ||
      !Number.isSafeInteger(p.worldVersion) ||
      p.worldVersion < 0 ||
      p.worldVersion > world.worldVersion ||
      p.sourceHash !== source.sourceHash ||
      at === null ||
      at > now!
    )
      fail();
  };
  if (input.playerPositionProof) validateProof(input.playerPositionProof);
  for (const p of input.historyFacts) {
    validateProof(p);
    if (!text(p.factKey)) fail();
  }
  for (const p of input.nodeProgress) {
    validateProof(p);
    const matches = nodes(p.nodeKey);
    if (
      matches.length !== 1 ||
      p.nodeHash !== matches[0]!.ref.nodeHash ||
      (p.kind !== 'presented' && p.kind !== 'resolved') ||
      (p.kind === 'resolved' && !outcomes.includes(p.outcome))
    )
      fail();
  }
  for (const p of input.stageProgress) {
    validateProof(p);
    if (p.status !== 'resolved' || stages(p.stageKey).length !== 1) fail();
  }
  const progress = (key: string) => input.nodeProgress.filter((p) => p.nodeKey === key);
  const resolved = (key: string) => progress(key).filter((p) => p.kind === 'resolved');
  const conflict = (key: string) => unique(resolved(key).map((p) => p.outcome)).length > 1;
  // Include only the selected, real causal witnesses, in a deterministic order.
  const proofIdentity = (p: AuthoredEligibilityEvidence) => {
    const node = input.nodeProgress.find((r) => r === p);
    const fact = input.historyFacts.find((r) => r === p);
    const stage = input.stageProgress.find((r) => r === p);
    return {
      worldId: p.worldId,
      engineEpoch: p.engineEpoch,
      worldVersion: p.worldVersion,
      sourceId: p.sourceId,
      sourceHash: p.sourceHash,
      at: new Date(instant(p.at)!).toISOString(),
      ...(node
        ? {
            kind: node.kind,
            nodeKey: node.nodeKey,
            nodeHash: node.nodeHash,
            ...(node.kind === 'resolved' ? { outcome: node.outcome } : {}),
          }
        : {}),
      ...(fact ? { factKey: fact.factKey } : {}),
      ...(stage ? { stageKey: stage.stageKey, status: stage.status } : {}),
    };
  };
  const combine = (checks: Check[], mode: 'all' | 'any'): Check => {
    // An ANY predicate needs one witness. Other branches cannot reset this qualification.
    const selected =
      mode === 'any' && checks.some((c) => c.ok) ? [checks.find((c) => c.ok)!] : checks;
    const ok = mode === 'all' ? checks.every((c) => c.ok) : checks.some((c) => c.ok);
    return check(
      ok,
      ok ? [] : unique(selected.flatMap((c) => c.reasons)),
      { mode, checks: selected.map((c) => c.cause) },
      selected.flatMap((c) => c.basis),
    );
  };
  const prerequisite = (p: AuthoredMaterialPrerequisite, m: AuthoredAgentMaterial): Check => {
    switch (p.kind) {
      case 'history_fact': {
        const proofs = input.historyFacts.filter((f) => f.factKey === p.factKey);
        return check(
          proofs.length > 0,
          proofs.length ? [] : ['history_fact_missing'],
          { predicate: p, met: proofs.length > 0 },
          proofs,
        );
      }
      case 'not_before': {
        const at = instant(p.at);
        return check(
          at !== null && now! >= at,
          at === null ? ['invalid_time'] : now! < at ? ['not_before'] : [],
          { predicate: p, phase: at === null ? 'invalid' : now! < at ? 'before' : 'open' },
        );
      }
      case 'at_place': {
        const refs = m.placeRefs.filter((r) => r.placeKey === p.placeKey);
        if (
          refs.length !== 1 ||
          refs[0]!.status !== 'resolved' ||
          !refs[0]!.placeId ||
          !refs[0]!.availableInWorld
        )
          return check(false, ['place_binding_missing'], { predicate: p, binding: 'unresolved' });
        if (!input.playerPositionProof || !input.playerPlaceId)
          return check(false, ['player_position_missing'], { predicate: p, position: 'unknown' });
        const ok = input.playerPlaceId === refs[0]!.placeId;
        return check(
          ok,
          ok ? [] : ['at_place_not_met'],
          { predicate: p, placeId: input.playerPlaceId, boundPlaceId: refs[0]!.placeId },
          [input.playerPositionProof],
        );
      }
      case 'after_presented_node': {
        const proofs = progress(p.nodeKey).filter((r) => r.kind === 'presented');
        return check(
          proofs.length > 0,
          proofs.length ? [] : ['node_not_presented'],
          { predicate: p, met: proofs.length > 0 },
          proofs,
        );
      }
      case 'after_committed_node':
      case 'after_resolved_node': {
        const proofs = resolved(p.nodeKey);
        if (conflict(p.nodeKey)) return check(false, ['proof_conflict'], { predicate: p }, proofs);
        if (
          p.kind === 'after_resolved_node' &&
          (!p.outcomes.length || p.outcomes.some((o) => !outcomes.includes(o)))
        )
          return check(false, ['unresolved_ref'], { predicate: p, invalid: true });
        const accepted = p.kind === 'after_resolved_node' ? p.outcomes : ['committed'];
        const ok = proofs.some((r) => accepted.includes(r.outcome));
        return check(
          ok,
          ok
            ? []
            : [
                p.kind === 'after_committed_node'
                  ? 'node_not_committed'
                  : proofs.length
                    ? 'outcome_mismatch'
                    : 'node_not_resolved',
              ],
          { predicate: p, met: ok },
          proofs,
        );
      }
      default:
        return check(false, ['unresolved_ref'], { invalidPredicate: true });
    }
  };
  return catalog.materials.map((m): AuthoredEventEligibility => {
    const finish = (
      status: AuthoredEventEligibility['status'],
      checks: Check[],
    ): AuthoredEventEligibility => {
      const basis = checks.flatMap((c) => c.basis);
      const identities = unique(
        basis.map((p) => authoredMaterialCanonicalJson(proofIdentity(p))),
      ).sort();
      const reasons = unique(checks.flatMap((c) => c.reasons)).sort();
      return {
        ref: m.ref,
        status,
        reasons,
        basisSourceIds: unique(basis.map((p) => p.sourceId)).sort(),
        qualificationKey: fingerprint({
          protocol: 'authored_event_eligibility_v1',
          worldId: world.worldId,
          engineEpoch: world.engineEpoch,
          ref: m.ref,
          status,
          causes: checks.map((c) => c.cause),
          witnesses: identities,
        }),
      };
    };
    const shown = progress(m.node.key).filter((p) => p.kind === 'presented');
    if (shown.length)
      return finish('already_presented', [
        check(false, ['already_presented'], { own: 'presented' }, shown),
      ]);
    const own = resolved(m.node.key);
    if (own.length) {
      if (conflict(m.node.key))
        return finish('blocked', [check(false, ['proof_conflict'], { own: 'conflict' }, own)]);
      return finish(own[0]!.outcome === 'expired' ? 'expired' : 'blocked', [
        check(false, ['already_resolved'], { own: own[0]!.outcome }, own),
      ]);
    }
    if (
      m.unresolvedRefs.length ||
      nodes(m.node.key).length !== 1 ||
      m.participantRefs.some((r) => r.status !== 'resolved' || !r.actorId)
    )
      return finish('blocked', [check(false, ['unresolved_ref'], { refs: m.unresolvedRefs })]);
    const checks: Check[] = [];
    const stage = m.node.timeline ? stages(m.node.timeline.stageKey) : [];
    if (m.node.timeline && stage.length !== 1)
      return finish('blocked', [
        check(false, ['unresolved_ref'], { stage: m.node.timeline.stageKey }),
      ]);
    // Both author windows constrain eligibility; expiry never creates a resolved progress fact.
    const windows = [m.node.timeline?.window, stage[0]?.window].filter((w) => w !== undefined);
    for (const w of windows) {
      const start = instant(w.notBefore),
        end = instant(w.expiresAt);
      const invalid = start === null || end === null || start >= end;
      const phase = invalid
        ? 'invalid'
        : now! < start
          ? 'before'
          : now! >= end
            ? 'expired'
            : 'open';
      checks.push(
        check(
          phase === 'open',
          phase === 'invalid'
            ? ['invalid_time']
            : phase === 'before'
              ? ['window_not_open']
              : phase === 'expired'
                ? ['window_expired']
                : [],
          { window: w, phase },
        ),
      );
    }
    if (checks.some((c) => c.reasons.includes('invalid_time'))) return finish('blocked', checks);
    if (checks.some((c) => c.reasons.includes('window_expired'))) return finish('expired', checks);
    for (const stageKey of stage[0]?.afterStageKeys ?? []) {
      const proofs = input.stageProgress.filter((p) => p.stageKey === stageKey);
      const known = stages(stageKey).length === 1;
      checks.push(
        check(
          known && proofs.length > 0,
          !known ? ['unresolved_ref'] : proofs.length ? [] : ['stage_dependency'],
          { stageKey, resolved: proofs.length > 0 },
          proofs,
        ),
      );
    }
    for (const p of m.node.prerequisites) checks.push(prerequisite(p, m));
    for (const key of m.node.conditionKeys ?? []) {
      const cs = catalog.conditions.filter((c) => c.key === key);
      if (cs.length !== 1 || !['all', 'any'].includes(cs[0]!.match)) {
        checks.push(check(false, ['unresolved_ref'], { condition: key }));
        continue;
      }
      const c = cs[0]!;
      const result = combine(
        c.prerequisites.map((p) => prerequisite(p, m)),
        c.match,
      );
      checks.push({
        ...result,
        reasons: result.ok ? [] : unique([...result.reasons, 'condition_not_met']),
        cause: { condition: key, result: result.cause },
      });
    }
    const exclusions = [
      ...m.node.mutuallyExclusiveNodeKeys.map((nodeKey) => ({
        nodeKey,
        outcomes: ['committed'] as AuthoredNodeOutcome[],
        reason: 'mutually_exclusive' as const,
      })),
      ...(m.node.timeline?.excludeIfResolved ?? []).map((r) => ({
        ...r,
        reason: 'excluded_by_resolution' as const,
      })),
    ];
    for (const r of exclusions) {
      const proofs = resolved(r.nodeKey);
      const known = nodes(r.nodeKey).length === 1;
      const badOutcomes = !r.outcomes.length || r.outcomes.some((o) => !outcomes.includes(o));
      const blocked = proofs.some((p) => r.outcomes.includes(p.outcome));
      checks.push(
        check(
          known && !badOutcomes && !conflict(r.nodeKey) && !blocked,
          !known || badOutcomes
            ? ['unresolved_ref']
            : conflict(r.nodeKey)
              ? ['proof_conflict']
              : blocked
                ? [r.reason]
                : [],
          { exclusion: r, blocked },
          proofs,
        ),
      );
    }
    return finish(checks.every((c) => c.ok) ? 'eligible' : 'blocked', checks);
  });
}
