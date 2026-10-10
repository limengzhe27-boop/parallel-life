import type {
  WorldSpace,
  TravelRequest,
  TravelReceipt,
  TravelRecovery,
} from '../../../contracts/world-space.ts';
export type TravelOperation = {
  request: TravelRequest;
  fromLabel: string;
  destinationLabel: string;
  status: 'pending' | 'unknown' | 'failed' | 'committed';
  receipt?: TravelReceipt;
  message?: string;
};
/** World-scoped controller supplied by the integration layer. No model call on read/travel. */
export type PhoneMapContext = {
  data: WorldSpace | null;
  operation: TravelOperation | null;
  checking: boolean;
  checkTravel: () => Promise<void>;
  retryTravel: () => Promise<void>;
  clearTravel: () => void;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  travel: (request: TravelRequest) => Promise<TravelReceipt>;
  enterPlace: (placeId: string) => Promise<void>;
  establish: () => Promise<void>;
  recover: (request: TravelRequest) => Promise<TravelRecovery>;
};
