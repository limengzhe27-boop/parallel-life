'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mergeGroupDetail } from './state.ts';
import { GroupClient, type GroupDetail, type GroupList } from './client.ts';
/** Group query cache only. Canonical World versions are always read from the API. */
export function useGroups(worldId: string, enabled: boolean, onWorldChanged?: () => Promise<void>) {
  const client = useMemo(() => new GroupClient(), [worldId]);
  const [list, setList] = useState<{ worldId: string; value: GroupList }>();
  const [details, setDetails] = useState<Record<string, GroupDetail>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0),
    mounted = useRef(true),
    changed = useRef(onWorldChanged);
  changed.current = onWorldChanged;
  const read = useCallback(
    async (id: string) => {
      const value = await client.read(worldId, id);
      if (mounted.current) setDetails((d) => ({ ...d, [id]: mergeGroupDetail(d[id], value) }));
      return value;
    },
    [client, worldId],
  );
  const refresh = useCallback(async () => {
    if (!enabled) return;
    const g = ++generation.current;
    setLoading(true);
    try {
      const value = await client.list(worldId);
      const results = await Promise.allSettled(
        value.groups.map((group) => client.read(worldId, group.id)),
      );
      if (!mounted.current || g !== generation.current) return;
      setList({ worldId, value });
      setDetails((previous) =>
        Object.fromEntries(
          results.flatMap((result, i) => {
            const id = value.groups[i]!.id;
            const detail =
              result.status === 'fulfilled'
                ? mergeGroupDetail(previous[id], result.value)
                : previous[id];
            return detail ? [[id, detail]] : [];
          }),
        ),
      );
      setError(
        results.some((r) => r.status === 'rejected')
          ? '部分群消息没能更新，请刷新再试。'
          : undefined,
      );
    } catch (e) {
      if (mounted.current && g === generation.current)
        setError(e instanceof Error ? e.message : '暂时没能连接，请刷新再试。');
    } finally {
      if (mounted.current && g === generation.current) setLoading(false);
    }
  }, [client, enabled, worldId]);
  const syncWorld = useCallback(async () => {
    // Reuse the existing integration callback; never duplicate the World store.
    try {
      await changed.current?.();
    } catch {
      /* Canonical group receipt stays valid; existing provider reports world refresh failure. */
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = setInterval(visible, 15000);
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted.current = false;
      generation.current++;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);
  return {
    client,
    worldId,
    enabled,
    list: enabled && list?.worldId === worldId ? list.value : undefined,
    details: enabled
      ? Object.fromEntries(Object.entries(details).filter(([, d]) => d.group.worldId === worldId))
      : {},
    loading,
    error,
    read,
    refresh,
    syncWorld,
  };
}
export type GroupsController = ReturnType<typeof useGroups>;
