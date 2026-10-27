'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePhoneApps } from '../apps/provider.tsx';
import { SceneClient } from './client.ts';
import {
  appointmentScene,
  canEnterAppointment,
  mergeHistory,
  sceneHomeEntry,
} from './index-state.ts';
import type { SceneHistory, SceneSummary } from '../../../contracts/scenes.ts';
import { routeHash } from '../navigation.ts';
import { worldDateTimeLabel } from '../../../modules/world/domain/display-time.ts';
import s from './scenes.module.css';
import type { PhoneAppContext } from '../phone-shell.tsx';
const status = { active: '正在现场', paused: '现场已暂停', ended: '已离场' };
export function SceneIndexApp({ map }: Pick<PhoneAppContext, 'map'>) {
  const { transport, worldId, data, actions } = usePhoneApps(),
    client = useMemo(() => new SceneClient(transport), [worldId, transport]);
  const [history, setHistory] = useState<SceneHistory>(),
    [records, setRecords] = useState<SceneSummary[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [entering, setEntering] = useState<string>();
  const pending = useRef(false),
    live = useRef(true);
  const enabled = !!actions.enterScene;
  const refresh = useCallback(
    async (before?: number) => {
      if (pending.current) return;
      pending.current = true;
      setLoading(true);
      setError('');
      try {
        const next = await client.history(worldId, before);
        if (live.current) {
          setHistory(next);
          setRecords((old) =>
            before === undefined ? next.scenes : mergeHistory(old, next.scenes),
          );
        }
      } catch (e) {
        if (live.current) setError(e instanceof Error ? e.message : '暂时没能读取现场记录。');
      } finally {
        pending.current = false;
        if (live.current) setLoading(false);
      }
    },
    [client, worldId],
  );
  useEffect(() => {
    live.current = true;
    if (enabled) void refresh();
    return () => {
      live.current = false;
    };
  }, [refresh, enabled]);
  const open = (id: string) => {
    window.location.hash = routeHash(worldId, { app: 'scenes', panel: 'scene', target: id });
  };
  async function enter(id: string) {
    if (entering || !actions.enterScene) return;
    setEntering(id);
    setError('');
    try {
      await actions.enterScene(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '暂时无法进入，请先检查最新状态。');
    } finally {
      setEntering(undefined);
    }
  }
  async function enterCurrentPlace() {
    const place = entry.currentPlace;
    if (!map || !place || !entry.canEnterCurrentPlace || entering) return;
    setEntering('place:' + place.id);
    setError('');
    try {
      await map.enterPlace(place.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '暂时无法进入，请先核对当前位置。');
    } finally {
      setEntering(undefined);
    }
  }
  const entry = sceneHomeEntry(history, map);
  const currentScene =
    history?.currentScene?.id === entry.currentSceneId ? history.currentScene : undefined;
  const appointments = data.invitations.filter((a) => a.status === 'confirmed');
  return (
    <div className={s.panel} data-scene-index>
      <section className={s.card}>
        <h3>现场</h3>
        <p>回到眼前的现场，或选择接下来要去的地方。历史记录随时可以回看。</p>
        {enabled ? (
          <button disabled={loading} onClick={() => void refresh()}>
            更新现场
          </button>
        ) : (
          <p>预览中没有真实现场记录。</p>
        )}
      </section>
      {loading ? (
        <p role="status">
          {history ? '正在更新现场记录，已有内容仍可查看…' : '正在读取现场与约定…'}
        </p>
      ) : null}
      {error ? (
        <p className={s.notice} role="alert">
          {error}
        </p>
      ) : null}
      {entry.currentSceneId ? (
        <section className={s.card}>
          <small>当前现场</small>
          <h3>{currentScene?.title ?? entry.currentPlace?.name ?? '当前现场'}</h3>
          {currentScene?.location ? <p>{currentScene.location}</p> : null}
          <button type="button" onClick={() => open(entry.currentSceneId!)}>
            回到现场
          </button>
          <p className={s.notice}>打开已有现场，不会重新生成或重复赴约。</p>
        </section>
      ) : history || map?.data ? (
        <section className={s.card}>
          <small>当前地点</small>
          <h3>{entry.currentPlace?.name ?? '当前位置尚未确认'}</h3>
          {entry.currentPlace ? (
            <button
              type="button"
              disabled={!entry.canEnterCurrentPlace || !!entering}
              onClick={() => void enterCurrentPlace()}
            >
              {entering?.startsWith('place:') ? '正在进入…' : '进入这里的现场'}
            </button>
          ) : null}
          {entry.blockedReason ? (
            <p className={s.notice}>{entry.blockedReason}</p>
          ) : (
            <p>看看周围，或做点什么。人物是否在场以实际情况为准。</p>
          )}
        </section>
      ) : null}
      <section className={s.card}>
        <h3>前往地点</h3>
        <p>选择地点后，在地图确认路线再前往。</p>
        <button
          type="button"
          onClick={() => {
            window.location.hash = routeHash(worldId, { app: 'map' });
          }}
        >
          打开地图
        </button>
        {map?.data?.places.length ? (
          <details>
            <summary>查看地点</summary>
            <div className={s.buttons}>
              {map.data.places
                .filter((place) => place.id !== map.data?.currentPlaceId)
                .map((place) => (
                  <button
                    type="button"
                    key={place.id}
                    onClick={() => {
                      window.location.hash = routeHash(worldId, { app: 'map', target: place.id });
                    }}
                  >
                    {place.name}
                  </button>
                ))}
            </div>
          </details>
        ) : null}
      </section>
      {appointments.length && history ? (
        <section className={s.card}>
          <h3>已确认的约定</h3>
          {appointments.map((a) => {
            const record = appointmentScene(history, a),
              ready = canEnterAppointment(history, a, data.referenceTime),
              venue = map?.data?.places.find((p) => p.appointmentIds.includes(a.id)),
              needsTravel = !!venue && map?.data?.currentPlaceId !== venue.id;
            return (
              <div key={a.id} className={s.indexRow}>
                <strong>{a.title}</strong>
                <small>{worldDateTimeLabel(a.at)}</small>
                {record ? (
                  <button onClick={() => open(record.id)}>查看已有现场</button>
                ) : (
                  <>
                    <button
                      disabled={!ready || !!entering}
                      onClick={() => {
                        if (needsTravel)
                          window.location.hash = routeHash(worldId, {
                            app: 'map',
                            target: venue!.id,
                          });
                        else void enter(a.id);
                      }}
                    >
                      {entering === a.id
                        ? '正在进入…'
                        : needsTravel
                          ? `前往${venue!.name}`
                          : '进入现场'}
                    </button>
                    {!ready ? (
                      <small>
                        {history.paused
                          ? '这段人生的时间已暂停，暂时无法进入新的现场。'
                          : history.currentScene
                            ? '请先处理当前现场。'
                            : '约定时间还未到。'}
                      </small>
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
        </section>
      ) : null}
      {history ? (
        <section className={s.card}>
          <h3>历史现场</h3>
          {records.length ? (
            records.map((record) => (
              <div className={s.indexRow} key={record.id}>
                <strong>{record.title}</strong>
                <small>
                  {status[record.status]}
                  {record.storyAt ? ' · ' + worldDateTimeLabel(record.storyAt) : ''}
                </small>
                {record.location ? <span>{record.location}</span> : null}
                <button onClick={() => open(record.id)}>查看记录</button>
              </div>
            ))
          ) : (
            <p>还没有现场记录。</p>
          )}
          {history.nextBefore !== null ? (
            <button disabled={loading} onClick={() => void refresh(history.nextBefore!)}>
              更早的记录
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
