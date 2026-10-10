import type { PlayerRecords } from '../../contracts/world-records.ts';
import type { WorldPhone } from '../../contracts/world-build.ts';

export type RecordsReader = {
  readWorldRecords(worldId: string): Promise<PlayerRecords>;
  world(worldId: string): Promise<WorldPhone>;
};
export class RecordsReadError extends Error {
  constructor() {
    super('记录正在更新，请稍后再试。');
  }
}
/** A bounded read-only reconciliation. Obsolete requests stop before issuing another read. */
export async function readCoherentRecords(
  reader: RecordsReader,
  worldId: string,
  phoneVersion: number,
  isCurrent: () => boolean,
): Promise<{ records: PlayerRecords; phone?: WorldPhone } | undefined> {
  let version = phoneVersion;
  let phone: WorldPhone | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!isCurrent()) return;
    const records = await reader.readWorldRecords(worldId);
    if (!isCurrent()) return;
    if (records.worldId !== worldId) throw new RecordsReadError();
    if (records.worldVersion === version) return { records, ...(phone ? { phone } : {}) };
    phone = await reader.world(worldId);
    if (!isCurrent()) return;
    if (phone.id !== worldId || (phone.version ?? 0) < phoneVersion) throw new RecordsReadError();
    version = phone.version ?? 0;
    if (records.worldVersion === version) return { records, phone };
  }
  throw new RecordsReadError();
}
/** User-safe records-only errors. Never surface an arbitrary upstream exception message. */
export function recordsReadError(error: unknown): string {
  if (error instanceof RecordsReadError) return error.message;
  return '这部分暂时无法读取，私人便签仍可使用。请重试。';
}
