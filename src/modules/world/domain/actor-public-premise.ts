import { authoredSourceExcerpt } from './authored-source-excerpt.ts';
import type { selectActorPersona } from './actor-situation.ts';

export type ActorPublicPremise = {
  /** Existing persona compaction preserves identity and boundary objects intact. */
  identity: { sourceId: string; authority: 'public_background_only' };
  boundary: string;
  publicSetting?: string;
  protagonistPublicIdentity?: string;
  excerptedFields?: ('publicSetting' | 'protagonistPublicIdentity')[];
};
const limits = { publicSetting: 1800, protagonistPublicIdentity: 240 } as const;
/** Only explicit public fields of the already definition-bound persona may cross this projection. */
export function projectActorPublicPremise(
  persona: string,
  definitionSourceId: string,
  topic: string,
): ActorPublicPremise | undefined {
  if (!/^definition:[a-f0-9]{64}$/.test(definitionSourceId)) return undefined;
  let original: unknown;
  try {
    original = JSON.parse(persona);
  } catch {
    return undefined;
  }
  if (!original || typeof original !== 'object' || Array.isArray(original)) return undefined;
  const source = original as Record<string, unknown>;
  const fields: Partial<Pick<ActorPublicPremise, keyof typeof limits>> = {};
  const excerptedFields: NonNullable<ActorPublicPremise['excerptedFields']> = [];
  for (const field of Object.keys(limits) as (keyof typeof limits)[]) {
    const value = source[field];
    if (typeof value !== 'string' || !value.trim()) continue;
    const selected = authoredSourceExcerpt(value.trim(), topic, limits[field]);
    if (!selected) continue;
    fields[field] = selected;
    if (selected !== value.trim()) excerptedFields.push(field);
  }
  if (!Object.keys(fields).length) return undefined;
  return {
    identity: { sourceId: definitionSourceId, authority: 'public_background_only' },
    boundary:
      '公开背景与身份设定，不证明当前事件、实时位置、他人知情、人物已经行动或玩家已经决定。',
    ...fields,
    ...(excerptedFields.length ? { excerptedFields } : {}),
  };
}
/** Keep five-dimension persona and public premise together; legacy-only snapshots retain their codec. */
export function actorSnapshotPersona(input: {
  persona: string;
  relationship?: string;
  modules: ReturnType<typeof selectActorPersona>;
  definitionSourceId: string;
  topic: string;
}): string {
  const publicPremise = input.modules
    ? projectActorPublicPremise(input.persona, input.definitionSourceId, input.topic)
    : undefined;
  return JSON.stringify({
    ...(input.modules ? {} : { persona: input.persona }),
    relationship: input.relationship,
    modules: input.modules,
    ...(publicPremise ? { publicPremise } : {}),
  });
}
