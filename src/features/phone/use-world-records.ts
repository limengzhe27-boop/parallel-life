'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LifeClient } from '../api/client.ts';
import type { WorldPhone } from '../../contracts/world-build.ts';
import type { PhoneRecordsState } from './apps/types.ts';
import { readCoherentRecords, recordsReadError } from './records-loader.ts';

type Stored = { worldId: string; version?: number; state: PhoneRecordsState };
/** Independent from phone loading, errors and private drafts. */
export function useWorldRecords(
  client: LifeClient,
  worldId: string,
  phoneVersion: number | undefined,
  acceptPhone: (phone: WorldPhone) => void,
) {
  const [stored, setStored] = useState<Stored>({
    worldId,
    version: phoneVersion,
    state: { status: 'loading' },
  });
  const storedRef = useRef(stored);
  const target = useRef({ worldId, phoneVersion });
  target.current = { worldId, phoneVersion };
  const sequence = useRef(0);
  const publish = useCallback((next: Stored) => {
    storedRef.current = next;
    setStored(next);
  }, []);
  const reloadRecords = useCallback(async () => {
    const id = ++sequence.current;
    const isCurrent = () =>
      id === sequence.current &&
      target.current.worldId === worldId &&
      target.current.phoneVersion === phoneVersion;
    publish({ worldId, version: phoneVersion, state: { status: 'loading' } });
    if (phoneVersion === undefined) return;
    try {
      const result = await readCoherentRecords(client, worldId, phoneVersion, isCurrent);
      if (!result || !isCurrent()) return;
      if (result.phone) acceptPhone(result.phone);
      publish({
        worldId,
        version: result.records.worldVersion,
        state: { status: 'ready', data: result.records },
      });
    } catch (error) {
      if (isCurrent())
        publish({
          worldId,
          version: phoneVersion,
          state: { status: 'error', error: recordsReadError(error) },
        });
    }
  }, [client, worldId, phoneVersion, acceptPhone, publish]);
  useEffect(() => {
    const current = storedRef.current;
    if (
      current.worldId !== worldId ||
      current.version !== phoneVersion ||
      current.state.status !== 'ready'
    )
      void reloadRecords();
    return () => {
      sequence.current++;
    };
  }, [worldId, phoneVersion, reloadRecords]);
  const records: PhoneRecordsState =
    stored.worldId === worldId && stored.version === phoneVersion
      ? stored.state
      : { status: 'loading' };
  return { records, reloadRecords };
}
