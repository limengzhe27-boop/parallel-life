'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorldSpace, TravelRequest, TravelReceipt } from '../../../contracts/world-space.ts';
import type { PhoneMapContext, TravelOperation } from './context.ts';
import { SpaceClient, SpaceFailure } from './client.ts';
import { restoreTravel, storeTravel } from './operation.ts';
import { routeHash } from '../navigation.ts';
import { SceneClient } from '../scenes/client.ts';
export function useWorldMap(
  worldId: string,
  version: number,
  enabled: boolean,
  onReload?: () => Promise<void>,
): PhoneMapContext {
  const client = useMemo(() => new SpaceClient(), [worldId]);
  const [data, setData] = useState<WorldSpace | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null),
    [operation, setOperation] = useState<TravelOperation | null>(null),
    [checking, setChecking] = useState(false),
    [working, setWorking] = useState(false);
  const reloadRef = useRef(onReload);
  reloadRef.current = onReload;
  const sequence = useRef(0),
    live = useRef(true),
    op = useRef<TravelOperation | null>(null),
    guard = useRef(false),
    enter = useRef<{ commandId: string; expectedVersion: number; placeId: string } | null>(null),
    establishCommand = useRef<{ commandId: string; expectedVersion: number } | null>(null);
  const publish = useCallback(
    (next: TravelOperation | null, required = false) => {
      try {
        localStorage.setItem('pl-travel:' + worldId, storeTravel(worldId, next));
      } catch {
        if (required)
          throw new SpaceFailure(
            'INVALID_COMMAND',
            '\u672a\u80fd\u4fdd\u5b58\u884c\u7a0b\u8bb0\u5f55\uff0c\u8bf7\u5141\u8bb8\u6d4f\u89c8\u5668\u5b58\u50a8\u540e\u518d\u8bd5\u3002',
            false,
          );
      }
      op.current = next;
      setOperation(next);
    },
    [worldId],
  );
  useEffect(() => {
    live.current = true;
    try {
      const restored = restoreTravel(localStorage.getItem('pl-travel:' + worldId), worldId);
      op.current = restored;
      setOperation(restored);
    } catch {}
    return () => {
      live.current = false;
      sequence.current++;
    };
  }, [worldId]);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    const id = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const next = await client.read(worldId);
      await reloadRef.current?.();
      if (live.current && id === sequence.current) setData(next);
    } catch (e) {
      if (live.current && id === sequence.current)
        setError(
          e instanceof Error ? e.message : '\u5730\u70b9\u6682\u65f6\u6ca1\u80fd\u6253\u5f00\u3002',
        );
    } finally {
      if (live.current && id === sequence.current) setLoading(false);
    }
  }, [client, worldId, enabled, version]);
  useEffect(() => {
    void refresh();
  }, [version, refresh]);
  const after = useCallback(async () => {
    await refresh();
  }, [refresh]);
  const accept = useCallback(
    async (r: TravelReceipt, previous: TravelOperation) => {
      publish({ ...previous, status: 'committed', receipt: r, message: undefined });
      await after();
    },
    [publish, after],
  );
  const travel = useCallback(
    async (request: TravelRequest) => {
      if (guard.current || op.current?.status === 'pending' || op.current?.status === 'unknown')
        throw new SpaceFailure(
          'BUSY',
          '\u8bf7\u5148\u6838\u5bf9\u4e0a\u4e00\u6b21\u884c\u7a0b\u3002',
          false,
        );
      const route = data?.routes.find((r) => r.id === request.routeId);
      if (
        !data ||
        !route ||
        data.paused ||
        data.busy ||
        data.worldVersion !== request.expectedVersion
      )
        throw new SpaceFailure(
          'INVALID_COMMAND',
          '\u8bf7\u5237\u65b0\u540e\u518d\u9009\u62e9\u8def\u7ebf\u3002',
          false,
        );
      guard.current = true;
      setWorking(true);
      const next: TravelOperation = {
        request,
        fromLabel: data.places.find((p) => p.id === route.fromPlaceId)!.name,
        destinationLabel: data.places.find((p) => p.id === route.toPlaceId)!.name,
        status: 'pending',
      };
      try {
        publish(next, true);
        const r = await client.travel(worldId, request);
        await accept(r, next);
        return r;
      } catch (e) {
        publish({
          ...next,
          status: e instanceof SpaceFailure && !e.unknown ? 'failed' : 'unknown',
          message: e instanceof Error ? e.message : undefined,
        });
        await refresh();
        throw e;
      } finally {
        guard.current = false;
        setWorking(false);
      }
    },
    [data, publish, client, worldId, accept, refresh],
  );
  const recover = useCallback(
    async (request: TravelRequest) => client.recover(worldId, request),
    [client, worldId],
  );
  const checkTravel = useCallback(async () => {
    const pending = op.current;
    if (!pending || guard.current) return;
    guard.current = true;
    setWorking(true);
    setChecking(true);
    try {
      const r = await recover(pending.request);
      if (r.status === 'committed') await accept(r, pending);
      else if (pending.status !== 'failed')
        publish({
          ...pending,
          status: 'unknown',
          recoveryUnconfirmed: true,
          message:
            '\u5c1a\u672a\u627e\u5230\u5df2\u63d0\u4ea4\u7684\u56de\u6267\uff0c\u884c\u7a0b\u7ed3\u679c\u4ecd\u672a\u786e\u8ba4\u3002',
        });
    } catch (e) {
      publish({
        ...pending,
        recoveryUnconfirmed: false,
        message: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setChecking(false);
      guard.current = false;
      setWorking(false);
    }
  }, [recover, accept, publish]);
  const retryTravel = useCallback(async () => {
    const pending = op.current;
    if (!pending || pending.status !== 'failed' || guard.current) return;
    guard.current = true;
    setWorking(true);
    setChecking(true);
    let retry = false;
    try {
      const r = await recover(pending.request);
      if (r.status === 'committed') await accept(r, pending);
      else {
        await refresh();
        retry = true;
      }
    } catch (e) {
      publish({
        ...pending,
        status: 'unknown',
        message: e instanceof Error ? e.message : undefined,
      });
    } finally {
      guard.current = false;
      setWorking(false);
      setChecking(false);
    }
    if (retry) {
      try {
        await travel(pending.request);
      } catch {
        /* The persisted operation owns the visible error. */
      }
    }
  }, [recover, accept, refresh, publish, travel]);
  const resubmitTravel = useCallback(async () => {
    const pending = op.current;
    if (!pending || pending.status !== 'unknown' || !pending.recoveryUnconfirmed || guard.current)
      return;
    guard.current = true;
    setWorking(true);
    setChecking(true);
    try {
      const r = await recover(pending.request);
      if (r.status === 'committed') {
        await accept(r, pending);
        return;
      }
      const next = { ...pending, status: 'pending' as const, recoveryUnconfirmed: false };
      publish(next, true);
      try {
        await accept(await client.travel(worldId, pending.request), next);
      } catch (e) {
        publish({
          ...next,
          status: e instanceof SpaceFailure && !e.unknown ? 'failed' : 'unknown',
          message: e instanceof Error ? e.message : undefined,
        });
        await refresh();
      }
    } catch (e) {
      publish({
        ...pending,
        recoveryUnconfirmed: false,
        message: e instanceof Error ? e.message : undefined,
      });
    } finally {
      guard.current = false;
      setWorking(false);
      setChecking(false);
    }
  }, [recover, accept, publish, client, worldId, refresh]);
  const clearTravel = useCallback(() => {
    if (!guard.current && op.current && ['failed', 'committed'].includes(op.current.status))
      publish(null);
  }, [publish]);
  const enterPlace = useCallback(
    async (placeId: string) => {
      if (guard.current || !data || data.paused || data.busy || op.current?.status === 'unknown')
        throw new SpaceFailure(
          'BUSY',
          '\u8bf7\u5148\u7b49\u5f85\u5f53\u524d\u64cd\u4f5c\u7ed3\u679c\u3002',
          false,
        );
      guard.current = true;
      setWorking(true);
      try {
        if (data.currentSceneId) {
          window.location.hash = routeHash(worldId, {
            app: 'scenes',
            panel: 'scene',
            target: data.currentSceneId,
          });
          return;
        }
        if (enter.current?.placeId !== placeId)
          enter.current = {
            commandId: crypto.randomUUID(),
            expectedVersion: data.worldVersion,
            placeId,
          };
        const r = await client.enter(worldId, enter.current);
        window.location.hash = routeHash(worldId, {
          app: 'scenes',
          panel: 'scene',
          target: r.sceneId,
        });
        await after();
        if (r.task?.status === 'queued') {
          await new SceneClient().execute(r.task.id);
          await after();
        }
        enter.current = null;
      } catch (e) {
        setError(
          e instanceof Error ? e.message : '\u73b0\u573a\u6682\u65f6\u6ca1\u80fd\u6253\u5f00\u3002',
        );
        await refresh();
        throw e;
      } finally {
        guard.current = false;
        setWorking(false);
      }
    },
    [data, worldId, client, after, refresh],
  );
  const establish = useCallback(async () => {
    if (guard.current || !data?.canEstablish || data.busy) return;
    guard.current = true;
    setWorking(true);
    try {
      if (!establishCommand.current)
        establishCommand.current = {
          commandId: crypto.randomUUID(),
          expectedVersion: data.worldVersion,
        };
      await client.establish(worldId, establishCommand.current);
      establishCommand.current = null;
      await after();
    } catch (e) {
      setError(e instanceof Error ? e.message : '\u5730\u70b9\u5c1a\u672a\u786e\u8ba4\u3002');
      await refresh();
      throw e;
    } finally {
      guard.current = false;
      setWorking(false);
    }
  }, [data, client, worldId, after, refresh]);
  return {
    data: data?.worldId === worldId && data.worldVersion === version && !error ? data : null,
    loading,
    error,
    refresh,
    operation:
      data?.worldId === worldId && data.worldVersion === version && !error ? operation : null,
    checking,
    working,
    resubmitTravel,
    checkTravel,
    retryTravel,
    clearTravel,
    travel,
    recover,
    enterPlace,
    establish,
  };
}
