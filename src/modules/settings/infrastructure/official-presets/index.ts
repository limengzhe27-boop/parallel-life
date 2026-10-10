import type { OfficialLifeCatalog } from '../../application/official-life-pack.ts';
import { countyYellowHair } from './county-yellow-hair.ts';
import { onlyChild } from './only-child.ts';
import { returnedDaughter } from './returned-daughter.ts';
import { retiredStar } from './retired-star.ts';

/** Server composition must project safe cards; do not import packs into client UI. */
export const OFFICIAL_LIFE_PACKS = [
  countyYellowHair,
  onlyChild,
  returnedDaughter,
  retiredStar,
] as const;
export const officialLifeCatalog: OfficialLifeCatalog = {
  list: () => structuredClone(OFFICIAL_LIFE_PACKS),
  get: (id) => {
    const pack = OFFICIAL_LIFE_PACKS.find((item) => item.card.id === id);
    return pack ? structuredClone(pack) : undefined;
  },
};
