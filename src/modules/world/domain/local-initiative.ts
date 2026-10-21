/** Select one locally relevant actor without a Director round. */
export function selectLocalInitiativeActor(input: {
  storyAt: string;
  actors: readonly { id: string; lastAssistantAt?: string }[];
  globalGapMs?: number;
  perActorGapMs?: number;
}): string | undefined {
  const now = Date.parse(input.storyAt);
  if (!Number.isFinite(now)) return undefined;
  const latest = input.actors
    .map((a) => a.lastAssistantAt)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);
  if (latest && now - Date.parse(latest) < (input.globalGapMs ?? 60_000)) return undefined;
  return input.actors
    .filter((actor) => {
      if (!actor.lastAssistantAt) return true;
      const at = Date.parse(actor.lastAssistantAt);
      return Number.isFinite(at) && now - at >= (input.perActorGapMs ?? 30 * 60_000);
    })
    .sort((a, b) => {
      const av = a.lastAssistantAt ? Date.parse(a.lastAssistantAt) : 0;
      const bv = b.lastAssistantAt ? Date.parse(b.lastAssistantAt) : 0;
      return av - bv;
    })[0]?.id;
}
