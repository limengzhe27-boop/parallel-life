import type { PlayerRecords } from '../domain/player-records.ts';
export interface PlayerRecordsReader {
  read(ownerId: string, worldId: string): Promise<PlayerRecords>;
}
