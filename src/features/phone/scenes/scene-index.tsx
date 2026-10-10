'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePhoneApps } from '../apps/provider.tsx';
import { SceneClient } from './client.ts';
import { appointmentScene, canEnterAppointment, mergeHistory } from './index-state.ts';
import type { SceneHistory, SceneSummary } from '../../../contracts/scenes.ts';
import { routeHash } from '../navigation.ts';
import { worldDateTimeLabel } from '../../../modules/world/domain/display-time.ts';
import s from './scenes.module.css';
const status = { active: '正在现场', paused: '现场已暂停', ended: '已离场' };
export function SceneIndexApp() {
  const { worldId, data, actions } = usePhoneApps(),
    client = useMemo(() => new SceneClient(), [worldId]);
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
  const appointments = data.invitations.filter((a) => a.status === 'confirmed');
  return (
    <div className={s.panel} data-scene-index>
      <section className={s.card}>
        <h3>现场</h3>
        <p>查看已经发生的现场，或前往确认过的约定。打开记录不会重新赴约。</p>
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
      {history?.currentScene ? (
        <section className={s.card}>
          <small>当前现场</small>
          <h3>{history.currentScene.title}</h3>
          <p>{history.currentScene.location ?? '现场开场后可查看地点与环境'}</p>
          <button
            disabled={!!entering}
            onClick={() =>
              history.currentScene!.appointmentId
                ? void enter(history.currentScene!.appointmentId)
                : open(history.currentScene!.id)
            }
          >
            {entering ? '正在返回现场…' : '回到现场'}
          </button>
          <p className={s.notice}>回到手机只切换视图；离开现场需要在现场里确认。</p>
        </section>
      ) : history ? (
        <section className={s.card}>
          <h3>当前没有进行中的现场</h3>
          <p>可以回看记录，或从已确认且已到时间的约定进入。</p>
        </section>
      ) : null}
      {appointments.length && history ? (
        <section className={s.card}>
          <h3>已确认的约定</h3>
          {appointments.map((a) => {
            const record = appointmentScene(history, a),
              ready = canEnterAppointment(history, a);
            return (
              <div key={a.id} className={s.indexRow}>
                <strong>{a.title}</strong>
                <small>{worldDateTimeLabel(a.at)}</small>
                {record ? (
                  <button onClick={() => open(record.id)}>查看已有现场</button>
                ) : (
                  <>
                    <button disabled={!ready || !!entering} onClick={() => void enter(a.id)}>
                      {entering === a.id ? '正在进入…' : '进入现场'}
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
          <h3>现场记录</h3>
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
