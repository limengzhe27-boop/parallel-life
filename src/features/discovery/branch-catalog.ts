import type { ApprovedSeed } from '../../contracts/seeds.ts';
import type { OfficialLifeCard } from '../../contracts/official-lives.ts';
import type { WorldBuild } from '../../contracts/world-build.ts';

/** Only hide a duplicate when the directory has an actual link to this exact save. */
export function visibleSavedSeeds(
  seeds: readonly ApprovedSeed[],
  builds: readonly WorldBuild[],
  catalog: readonly OfficialLifeCard[],
): ApprovedSeed[] {
  return seeds.filter((seed) => {
    if (!('source' in seed) || seed.source.kind !== 'official_life') return true;
    const presetId = seed.source.presetId;
    const card = catalog.find((item) => item.id === presetId);
    const build = builds.find((item) => item.seedId === seed.id);
    if (!card || !build?.worldId || !build.ready) return true;
    return ![card.worldId, card.legacyWorldId, card.currentVersionWorldId].includes(build.worldId);
  });
}
