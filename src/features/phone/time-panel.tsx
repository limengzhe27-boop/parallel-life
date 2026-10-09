'use client';
import { useEffect, useState, useRef } from 'react';
import type { LifeClient } from '../api/client.ts';
import type { WorldClock } from '../../contracts/world-clock.ts';
import { worldDateTimeLabel } from '../../modules/world/domain/display-time.ts';
import s from './scenes/scenes.module.css';
export function TimePanel({
  client,
  worldId,
  onWorldChanged,
}: {
  client: LifeClient;
  worldId: string;
  onWorldChanged?: () => Promise<void>;
}) {
  const [clock, setClock] = useState<WorldClock>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [note, setNote] = useState(''),
    [needsConfirmation, setNeedsConfirmation] = useState(false),
    [confirmAdvance, setConfirmAdvance] = useState(false);
  const running = useRef(false);
  async function load(preserveError = false) {
    try {
      setClock(await client.readWorldClock(worldId));
      if (!preserveError) setError('');
    } catch {
      setError('时间暂时没能读取，请重试。');
    }
  }
  useEffect(() => {
    void load();
  }, [client, worldId]);
  async function run(action: () => Promise<void>, advancing = false) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    setNote('');
    try {
      await action();
      if (advancing) setNeedsConfirmation(false);
    } catch (e) {
      if (
        advancing &&
        ['UNKNOWN', 'AI_TIMEOUT', 'UNAVAILABLE'].includes((e as { code?: string }).code ?? '')
      )
        setNeedsConfirmation(true);
      setError(e instanceof Error ? e.message : '这次没有完成，请刷新核对。');
    } finally {
      await Promise.allSettled([load(true), onWorldChanged?.()]);
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <div className={s.panel}>
      <section className={s.card}>
        <small>这段人生的时间</small>
        <h3>{clock ? worldDateTimeLabel(clock.storyNow) : '正在读取…'}</h3>
        <p>{clock ? (clock.paused ? '已暂停' : `${clock.speed}× 流逝中`) : ''}</p>
        <div className={s.buttons}>
          <button
            disabled={!clock || busy}
            onClick={() =>
              void run(async () => {
                const c = await client.setWorldClock(worldId, { paused: !clock!.paused });
                setClock(c);
                setNote(c.paused ? '已暂停' : '已继续');
              })
            }
          >
            {clock?.paused ? '继续' : '暂停'}
          </button>
          {[1, 2].map((speed) => (
            <button
              key={speed}
              aria-pressed={clock?.speed === speed}
              disabled={!clock || busy}
              onClick={() =>
                void run(async () => {
                  setClock(await client.setWorldClock(worldId, { speed }));
                  setNote(`速度已设为 ${speed}×`);
                })
              }
            >
              {speed}×
            </button>
          ))}
        </div>
        <button
          disabled={!clock || busy || clock.paused}
          onClick={() => {
            if (needsConfirmation) {
              setConfirmAdvance(true);
              return;
            }
            void run(async () => {
              const result = await client.advanceWorld(worldId);
              setNote(result.played ? '新的进展已同步到手机。' : '这段时间没有新的进展。');
            }, true);
          }}
        >
          查看这段时间的进展
        </button>
        {confirmAdvance ? (
          <div role="group" aria-label="确认恢复时间推进">
            <p>先核对最新消息。上次结果还不能确认，再次继续可能产生费用。</p>
            <button
              disabled={busy}
              onClick={() => {
                setConfirmAdvance(false);
                void run(async () => {
                  const result = await client.advanceWorld(worldId);
                  setNote(result.played ? '新的进展已同步到手机。' : '这段时间没有新的进展。');
                }, true);
              }}
            >
              确认继续上次推进
            </button>
            <button onClick={() => setConfirmAdvance(false)}>取消</button>
          </div>
        ) : null}
        {clock?.summary ? <p>{clock.summary}</p> : null}
      </section>
      <p>时间继续流逝时，有依据的新消息和约定会更新到手机。</p>
      {error ? (
        <div role="alert">
          {error}
          <button disabled={busy} onClick={() => void load()}>
            重新读取时间
          </button>
        </div>
      ) : null}
      {note ? <p role="status">{note}</p> : null}
      {busy ? <p role="status">正在更新…</p> : null}
    </div>
  );
}
