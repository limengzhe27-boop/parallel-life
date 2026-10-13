import 'server-only';
import { Id } from '../contracts/api.ts';
import { PublisherPreparationInputSchema } from '../contracts/publisher-preparation.ts';
import { publisherServices } from './publisher-services.ts';
import {
  publisherEndpoint,
  publisherBody,
  publisherJson,
  PublisherHttpError,
} from './publisher-http.ts';
import { createManuscriptTextModel } from './composition.ts';
import { PublicationManuscriptPlanner } from '../modules/settings/infrastructure/publication-manuscript-planner.ts';
import { preparePublisherManuscript } from '../modules/settings/application/publisher-preparation.ts';

export function publisherPreparationRoute(request: Request, workId: string) {
  return publisherEndpoint(async () => {
    const s = publisherServices(request);
    const principal = await s.http.authorize(request, request.method === 'POST', 'edit');
    if (!Id.safeParse(workId).success) throw new PublisherHttpError('INVALID_INPUT');
    if (request.method === 'GET') {
      const commandId = new URL(request.url).searchParams.get('commandId');
      const found = await s.preparations.read(principal.id, workId, commandId ?? undefined);
      if (commandId && !found) throw new PublisherHttpError('NOT_FOUND');
      return publisherJson(commandId ? found : { preparation: found });
    }
    const input = await publisherBody(request, PublisherPreparationInputSchema, 393216);
    // Instantiate the gateway lazily: cached results still recover during provider outages.
    const result = await preparePublisherManuscript(
      s.preparations,
      {
        propose: (material, signal) =>
          new PublicationManuscriptPlanner(createManuscriptTextModel()).propose(material, signal),
      },
      principal.id,
      workId,
      input,
    );
    return publisherJson(result);
  });
}
