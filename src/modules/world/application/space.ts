import type {
  WorldSpace,
  TravelRequest,
  TravelReceipt,
  TravelRecovery,
} from '../../../contracts/world-space.ts';
export interface WorldSpacePort {
  read(ownerId: string, worldId: string): Promise<WorldSpace>;
  travel(ownerId: string, worldId: string, input: TravelRequest): Promise<TravelReceipt>;
  recover(ownerId: string, worldId: string, input: TravelRequest): Promise<TravelRecovery>;
}
