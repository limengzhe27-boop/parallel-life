import type { WorldSpace, TravelRequest, TravelReceipt, TravelRecovery } from '../../../contracts/world-space.ts';
/** World-scoped controller supplied by the integration layer. No model call on read/travel. */
export type PhoneMapContext = {
 data: WorldSpace | null;
 loading: boolean;
 error: string | null;
 refresh: () => Promise<void>;
 travel: (request: TravelRequest) => Promise<TravelReceipt>;
 recover: (request: TravelRequest) => Promise<TravelRecovery>;
};
