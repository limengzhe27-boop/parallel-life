import type { TextModel } from '../modules/ai/application/ports.ts';
import type { PublisherPreparationPlanner } from '../modules/settings/application/publisher-preparation.ts';
import { PublicationManuscriptPlanner } from '../modules/settings/infrastructure/publication-manuscript-planner.ts';

/** Cached preparations never initialize a provider; fresh admissions retain their fixed time reference. */
export function lazyPublicationManuscriptPlanner(
  createModel: () => TextModel,
  options?: { characterTrial?: boolean },
): PublisherPreparationPlanner {
  return {
    propose(...args) {
      return new PublicationManuscriptPlanner(createModel(), options).propose(...args);
    },
  };
}
