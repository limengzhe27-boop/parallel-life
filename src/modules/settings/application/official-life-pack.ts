import type { OfficialLifeCard, OfficialLifeId } from '../../../contracts/official-lives.ts';
import type { ApprovedSeed } from '../../../contracts/seeds.ts';
import type { OfficialOpeningDraft } from '../../world/domain/official-genesis.ts';

/** Server-only authored content. GET emits card fields only, not this full pack. */
export type OfficialLifePack = {
  card: Omit<OfficialLifeCard, 'worldId'>;
  /** Only a safe public summary enters the approved seed. */
  story: ApprovedSeed['story'];
  opening: OfficialOpeningDraft;
};
export interface OfficialLifeCatalog {
  list(): readonly OfficialLifePack[];
  get(id: OfficialLifeId): OfficialLifePack | undefined;
}
