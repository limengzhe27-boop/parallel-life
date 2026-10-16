import type { WorldPhone } from '../../contracts/world-build.ts';
/** Only the authorized immutable opening binding can select an author character. */
export function wechatCharacterTarget(actors: WorldPhone['actors'], key: string) {
  const matches = actors.filter((actor) => actor.publicationActorKey === key);
  return matches.length === 1 ? matches[0]!.id : undefined;
}
