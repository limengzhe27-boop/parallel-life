import type { AuthoredAgentMaterial } from './authored-agent-material.ts';
import type { ActorEpisodeDirective } from './actor-episode-intent.ts';

export const ACTOR_MANUSCRIPT_HINT_PROTOCOL = 'actor-manuscript-hint-v1';
export type ManuscriptHintIdentity = { id: string; name: string };
export type ActorManuscriptHint = {
  directive: Extract<ActorEpisodeDirective, { kind: 'task_suggestion' }>;
  provenance: {
    protocol: typeof ACTOR_MANUSCRIPT_HINT_PROTOCOL;
    field: 'script' | 'editorialIntent';
    start: number;
    end: number;
  };
};

/**
 * One literal author-permission block at the start of the displayed manuscript body.
 * It is not a general Markdown parser or a claim that its text states true facts.
 * Examples must be quoted/fenced or preceded by ordinary text, never a naked first block.
 */
export function projectActorManuscriptHint(
  material: AuthoredAgentMaterial,
  actorId: string,
  initialActors: readonly ManuscriptHintIdentity[],
  currentActors: readonly ManuscriptHintIdentity[],
): ActorManuscriptHint | null {
  if (!['editorial_only', 'director_event'].includes(material.node.intent.kind)) return null;
  const field = material.node.script == null ? 'editorialIntent' : 'script';
  const body = material.node[field];
  if (
    typeof body !== 'string' ||
    body.length > 65536 ||
    initialActors.length > 64 ||
    currentActors.length > 64
  )
    return null;
  const hints = new Map<string, ActorManuscriptHint>();
  let opened = false,
    closed = false,
    offset = 0,
    total = 0;
  for (const raw of body.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const start = offset;
    offset += raw.length + 1;
    if (!opened) {
      if (/^[ \t]*$/.test(line)) continue;
      if (line !== ':::人物演绎提示') return null;
      opened = true;
      continue;
    }
    if (line === ':::') {
      closed = true;
      break;
    }
    if (/^[ \t]*$/.test(line)) continue;
    const colon = line.search(/[:：]/u);
    if (colon <= 0) return null;
    const name = line.slice(0, colon),
      text = line.slice(colon + 1);
    if (
      name !== name.trim() ||
      name.length > 120 ||
      /[\u0000-\u001f:：]/u.test(name) ||
      /[<>]/u.test(name) ||
      /^[>*#`~+-]/u.test(name) ||
      !text.trim() ||
      text.length > 2000
    )
      return null;
    total += text.length;
    if (total > 12000 || hints.size >= 64) return null;
    const initial = initialActors.filter((a) => a.name === name);
    if (initial.length !== 1 || initialActors.filter((a) => a.id === initial[0]!.id).length !== 1)
      return null;
    const target = initial[0]!;
    const current = currentActors.filter((a) => a.id === target.id);
    if (
      current.length !== 1 ||
      current[0]!.name !== name ||
      currentActors.filter((a) => a.name === name).length !== 1
    )
      return null;
    const refs = material.participantRefs.filter((r) => r.actorId === target.id);
    if (
      refs.length !== 1 ||
      refs[0]!.status !== 'resolved' ||
      material.participantRefs.filter((r) => r.actorKey === refs[0]!.actorKey).length !== 1 ||
      material.node.actorKeys.filter((k) => k === refs[0]!.actorKey).length !== 1 ||
      hints.has(target.id)
    )
      return null;
    hints.set(target.id, {
      directive: { kind: 'task_suggestion', text },
      provenance: {
        protocol: ACTOR_MANUSCRIPT_HINT_PROTOCOL,
        field,
        start: start + colon + 1,
        end: start + line.length,
      },
    });
  }
  return closed ? (hints.get(actorId) ?? null) : null;
}
