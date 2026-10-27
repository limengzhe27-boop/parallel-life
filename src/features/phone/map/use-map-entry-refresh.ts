'use client';
import { useEffect, useRef, useState } from 'react';
import type { PhoneMapContext } from './context.ts';

type EntryRead = { worldId: string; promise: Promise<void> };
/** One read per mounted entry/world, including effect replays; callback identity is not a new entry. */
export function mapEntryRead(
  previous: EntryRead | undefined,
  worldId: string,
  refresh: () => Promise<void>,
): EntryRead {
  return previous?.worldId === worldId
    ? previous
    : { worldId, promise: Promise.resolve().then(refresh) };
}

/** Reads the original map projection once; no timer, command, model or alternate state source. */
export function useMapEntryRefresh(worldId: string, map: PhoneMapContext | undefined) {
  const controller = useRef(map);
  controller.current = map;
  const read = useRef<EntryRead | undefined>(undefined);
  const available = Boolean(map);
  const [status, setStatus] = useState({ worldId, checking: available });
  useEffect(() => {
    let current = true;
    const selected = controller.current;
    if (!selected) {
      setStatus({ worldId, checking: false });
      return;
    }
    const next = mapEntryRead(read.current, worldId, () => selected.refresh());
    read.current = next;
    setStatus({ worldId, checking: true });
    const finish = () => {
      if (current) setStatus({ worldId, checking: false });
    };
    // The existing controller owns its read error; never turn a read failure into a write/retry.
    void next.promise.then(finish, finish);
    return () => {
      current = false;
    };
  }, [worldId, available]);
  return status.worldId === worldId ? status.checking : available;
}
