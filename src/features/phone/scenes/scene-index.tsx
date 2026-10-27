'use client';
import { useEffect, useRef, useState } from 'react';
import { usePhoneApps } from '../apps/provider.tsx';
import { useMapEntryRefresh } from '../map/use-map-entry-refresh.ts';
import { sceneHomeEntry } from './index-state.ts';
import { routeHash } from '../navigation.ts';
import s from './scenes.module.css';
import type { PhoneAppContext } from '../phone-shell.tsx';

/** The home icon opens the current place; it is not a scene-management page. */
export function SceneIndexApp({ map }: Pick<PhoneAppContext, 'map'>) {
  const { worldId } = usePhoneApps();
  const checking = useMapEntryRefresh(worldId, map);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const attempted = useRef<string | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const controller = useRef(map);
  controller.current = map;
  const current = map?.data?.worldId === worldId ? map : undefined;
  const entry = sceneHomeEntry(undefined, current);
  useEffect(() => {
    if (checking || current?.loading || current?.error || !current?.data) return;
    if (entry.currentSceneId) {
      window.location.hash = routeHash(worldId, {
        app: 'scenes',
        panel: 'scene',
        target: entry.currentSceneId,
      });
      return;
    }
    if (!entry.canEnterCurrentPlace || !entry.currentPlace) return;
    const key = `${worldId}:${entry.currentPlace.id}:${retry}`;
    if (attempted.current === key) return;
    attempted.current = key;
    void controller.current!.enterPlace(entry.currentPlace.id).catch((e: unknown) => {
      if (mounted.current) setError(e instanceof Error ? e.message : '现场暂时没能打开。');
    });
  }, [
    worldId,
    checking,
    current?.loading,
    current?.error,
    current?.data?.worldVersion,
    entry.currentSceneId,
    entry.currentPlace?.id,
    entry.canEnterCurrentPlace,
    retry,
  ]);
  const problem = error || current?.error;
  const blocked =
    !checking && !current?.loading && !entry.canEnterCurrentPlace && !entry.currentSceneId;
  return (
    <div className={`${s.panel} ${s.scenePanel}`} data-scene-direct-entry>
      <section className={s.sceneControls} aria-label="现场导航">
        <button
          type="button"
          aria-label="返回手机"
          onClick={() => {
            window.location.hash = routeHash(worldId, { app: null });
          }}
        >
          ‹
        </button>
        <strong className={s.locationTitle}>{entry.currentPlace?.name ?? '当前地点'}</strong>
      </section>
      <div className={s.reading} role={problem ? 'alert' : 'status'}>
        <p>{problem || (blocked ? entry.blockedReason : '看看眼前的环境…')}</p>
        {problem ? (
          <button
            type="button"
            onClick={async () => {
              setError('');
              try {
                await map?.refresh();
                setRetry((n) => n + 1);
              } catch (e) {
                setError(e instanceof Error ? e.message : '暂时没能读取当前位置。');
              }
            }}
          >
            重试打开
          </button>
        ) : null}
        {blocked || !map ? (
          <button
            type="button"
            onClick={() => {
              window.location.hash = routeHash(worldId, { app: 'map' });
            }}
          >
            查看地图
          </button>
        ) : null}
      </div>
      <form className={s.composer} onSubmit={(e) => e.preventDefault()}>
        <textarea disabled aria-label="现场输入" placeholder="想说点什么，或者做个动作……" />
        <button disabled type="submit">
          发送
        </button>
      </form>
    </div>
  );
}
