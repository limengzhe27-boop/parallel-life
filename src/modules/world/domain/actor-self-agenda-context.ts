import { authoredSourceExcerpt } from './authored-source-excerpt.ts';
import type { ActorAgentState } from './agent-runtime.ts';

/** A planning basis, never a seeded goal, fact, player task or permission to execute. */
export function actorSelfAgendaContext(input: {
  input: { origin: string; text: string };
  persona: string;
  definitionRef: string;
  sources: readonly { id: string }[];
  state: Pick<ActorAgentState, 'goals' | 'plans' | 'responsibilities'>;
}) {
  if (input.input.origin !== 'wake') return undefined;
  let kind: unknown;
  let persona: Record<string, unknown>;
  try {
    kind = JSON.parse(input.input.text)?.type;
    persona = JSON.parse(input.persona);
  } catch {
    return undefined;
  }
  if (!['npc_agenda_initialize', 'npc_agenda_review'].includes(String(kind))) return undefined;
  const sourceId = `definition:${input.definitionRef}`;
  if (input.sources.filter((source) => source.id === sourceId).length !== 1) return undefined;
  if (!persona || typeof persona !== 'object' || Array.isArray(persona)) return undefined;
  const object = (v: unknown): Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  let legacy = {};
  if (typeof persona.persona === 'string') {
    try {
      legacy = object(JSON.parse(persona.persona));
    } catch {}
  }
  const modules = object(persona.modules);
  const premise = object(persona.publicPremise);
  const brief = (v: unknown, budget: number) =>
    typeof v === 'string' && v.trim() ? authoredSourceExcerpt(v.trim(), '', budget) : undefined;
  const role = brief(modules.lifeContext ?? object(legacy).background, 500);
  const motivation = brief(modules.drives ?? object(legacy).motivation, 600);
  const premiseAuthorized = object(premise.identity).sourceId === sourceId;
  return {
    purpose: 'form_or_review_own_agenda' as const,
    trigger: kind === 'npc_agenda_initialize' ? ('initialize' as const) : ('review' as const),
    authority: 'self_planning_only' as const,
    definitionSourceId: sourceId,
    ...(role ? { ownRoleAndLifeContext: role } : {}),
    ...(motivation ? { ownMotivations: motivation } : {}),
    ...(premiseAuthorized && brief(premise.publicSetting, 600)
      ? { publicBackground: brief(premise.publicSetting, 600) }
      : {}),
    existingAgenda: {
      unfinishedGoals: input.state.goals.filter(
        (g) => !['fulfilled', 'withdrawn'].includes(g.status),
      ).length,
      unfinishedPlans: input.state.plans.filter(
        (p) => !['finished', 'withdrawn'].includes(p.status),
      ).length,
      waitingResponsibilities: input.state.responsibilities.filter((r) =>
        ['open', 'waiting', 'deferred'].includes(r.status),
      ).length,
    },
  };
}
