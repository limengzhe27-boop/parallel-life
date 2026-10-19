'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LifeClient } from '../api/client.ts';
import type { AdvanceOperationReceipt } from '../../contracts/advance-operation.ts';
import {
  restorePendingAdvances,
  advanceRecoveryAction,
  type PendingAdvance,
} from './advance-recovery-state.ts';
export function useAdvanceRecovery(
  client: LifeClient,
  worldId: string,
  onChanged: () => Promise<void>,
) {
  const [items, setItems] = useState<PendingAdvance[]>([]);
  const current = useRef({ worldId, items: [] as PendingAdvance[] });
  const busy = useRef(false);
  const persist = useCallback(
    (values: PendingAdvance[]) => {
      if (current.current.worldId !== worldId) return;
      current.current.items = values;
      setItems(values);
      try {
        sessionStorage.setItem('pl-advance-recovery:' + worldId, JSON.stringify(values.slice(-30)));
      } catch {
        /* Original receipt remains server-side. */
      }
    },
    [worldId],
  );
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem('pl-advance-recovery:' + worldId);
    } catch {
      /* Memory-only reconciliation remains available. */
    }
    const values = restorePendingAdvances(raw);
    current.current = { worldId, items: values };
    setItems(values);
  }, [worldId]);
  const accept = useCallback(
    (id: string, receipt: AdvanceOperationReceipt) => {
      if (
        current.current.worldId !== worldId ||
        receipt.worldId !== worldId ||
        receipt.operationId !== id
      )
        return;
      persist(
        current.current.items.flatMap((item) =>
          item.id !== id
            ? [item]
            : receipt.status === 'complete'
              ? []
              : [
                  {
                    ...item,
                    receipt,
                    state: receipt.status === 'absent' ? 'checking' : receipt.status,
                    nextCheckAt:
                      Date.now() +
                      (receipt.waitingOn
                        ? 15000
                        : receipt.status === 'unknown' || item.attempts >= 12
                          ? 60000
                          : Math.min(60000, 5000 * 2 ** Math.min(item.attempts, 4))),
                  },
                ],
        ),
      );
    },
    [worldId, persist],
  );
  const advance = useCallback(
    async (key: string) => {
      if (current.current.worldId !== worldId) return;
      const existing = current.current.items.find((i) => i.key === key);
      if (existing) return existing.receipt?.result;
      if (current.current.items.length >= 30) {
        const oldestTerminal = current.current.items.find((i) => i.state === 'failed');
        if (!oldestTerminal) return;
        persist(current.current.items.filter((i) => i.id !== oldestTerminal.id));
      }
      const item: PendingAdvance = {
        id: crypto.randomUUID(),
        key,
        attempts: 0,
        nextCheckAt: Date.now() + 5000,
        state: 'running',
      };
      persist([...current.current.items, item]);
      try {
        const receipt = await client.advanceOperation(worldId, item.id, 'start');
        accept(item.id, receipt);
        return receipt.result;
      } catch {
        if (current.current.worldId === worldId)
          persist(
            current.current.items.map((i) => (i.id === item.id ? { ...i, state: 'checking' } : i)),
          );
        // This exact identity is queried next. Never substitute a fresh scheduler request.
      }
    },
    [worldId, client, persist, accept],
  );
  const reconcile = useCallback(async () => {
    if (busy.current || current.current.worldId !== worldId) return;
    const item = current.current.items.find((i) => advanceRecoveryAction(i, Date.now()));
    if (!item) return;
    busy.current = true;
    persist(
      current.current.items.map((i) =>
        i.id === item.id
          ? {
              ...i,
              attempts: Math.min(12, i.attempts + 1),
              nextCheckAt: Date.now() + Math.min(60000, 5000 * 2 ** Math.min(i.attempts, 4)),
            }
          : i,
      ),
    );
    try {
      let receipt = await client.advanceOperation(
        worldId,
        item.id,
        advanceRecoveryAction(item, Date.now())!,
      );
      // A not-yet-accepted transport may use the SAME idempotent operation identity.
      if (receipt.status === 'absent' && item.attempts < 3)
        receipt = await client.advanceOperation(worldId, item.id, 'start');
      accept(item.id, receipt);
      if (
        item.state === 'recoverable' ||
        receipt.status === 'complete' ||
        receipt.result?.changed ||
        receipt.result?.played
      )
        await onChanged();
    } catch {
      /* Leave the same receipt pending; bounded backoff never sends another model. */
    } finally {
      busy.current = false;
    }
  }, [worldId, client, persist, accept, onChanged]);
  return { advance, reconcile, items };
}
