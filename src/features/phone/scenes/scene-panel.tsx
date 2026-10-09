'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SceneClient } from './client.ts';
import {
  sceneBusy,
  sceneStatus,
  mergeScene,
  restoreSceneCommand,
  type SceneTask,
} from './state.ts';
import type { SceneRead } from '../../../contracts/scenes.ts';
import type { PhoneContact } from '../apps/types.ts';
import { worldDateTimeLabel } from '../../../modules/world/domain/display-time.ts';
import { readRoute, routeHash } from '../navigation.ts';
import s from './scenes.module.css';
const states = {
  not_started: '还未开始',
  in_progress: '正在进行',
  blocked: '遇到阻碍',
  completed: '已完成',
  abandoned: '已放下',
};
export function ScenePanel({
  worldId,
  contacts,
  onWorldChanged,
  onBusy,
}: {
  worldId: string;
  contacts: readonly PhoneContact[];
  onWorldChanged?: () => Promise<void>;
  onBusy?: (busy: boolean) => void;
}) {
  const client = useMemo(() => new SceneClient(), [worldId]);
  const [data, setData] = useState<SceneRead>(),
    [task, setTask] = useState<SceneTask | null>(),
    [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [retryConfirm, setRetryConfirm] = useState(false),
    [leaveConfirm, setLeaveConfirm] = useState(false);
  const live = useRef(true),
    running = useRef(false),
    retryId = useRef<{ taskId: string; id: string } | undefined>(undefined),
    inputId = useRef<
      { text: string; id: string; version: number; relatedMatterIds?: string[] } | undefined
    >(undefined);
  const target =
    typeof window === 'undefined' ? undefined : readRoute(window.location.hash, worldId).target;
  const draftKey = `pl-scene-draft:${worldId}:${target ?? 'current'}`;
  const refresh = useCallback(async () => {
    const next = await client.read(worldId, target);
    if (live.current) {
      setData((d) => mergeScene(d, next));
      setTask(next.task);
    }
    return next;
  }, [client, worldId, target]);
  useEffect(() => {
    live.current = true;
    try {
      setText(sessionStorage.getItem(draftKey) ?? '');
      inputId.current = restoreSceneCommand(sessionStorage.getItem(draftKey + ':command'));
    } catch {}
    void refresh().catch((e) => {
      if (live.current) setError(e.message);
    });
    return () => {
      live.current = false;
    };
  }, [refresh, draftKey]);
  useEffect(() => {
    onBusy?.(busy || sceneBusy(task));
    // Shared observer continues polling a pending task after returning to phone.
  }, [busy, task?.status, onBusy]);
  useEffect(() => {
    if (!sceneBusy(task)) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh().catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [task?.id, task?.status, refresh]);
  const name = (id: string) => contacts.find((c) => c.id === id)?.name ?? '在场的人';
  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      if ((e as { code?: string }).code === 'VERSION_CONFLICT') {
        inputId.current = undefined;
        try {
          sessionStorage.removeItem(draftKey + ':command');
        } catch {}
      }
      if (live.current)
        setError(e instanceof Error ? e.message : '结果还不能确认，请重新读取核对。');
    } finally {
      await refresh().catch(() => {});
      await Promise.allSettled([onWorldChanged?.()]);
      running.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function execute(t: SceneTask) {
    if (t.status !== 'queued') return;
    const result = await client.execute(t.id);
    if (live.current) setTask(result);
  }
  const disabled =
    busy || sceneBusy(task) || !data?.scene || data.paused || data.scene.status !== 'active';
  return (
    <div className={`${s.panel} ${s.scenePanel}`}>
      {!data ? (
        <p role="status">正在打开现场…</p>
      ) : !data.scene ? (
        <div className={s.card}>
          <h3>还没有进入现场</h3>
          <p>在日历中打开已确认的约定，到了时间即可进入。</p>
          <button
            onClick={() => {
              window.location.hash = routeHash(worldId, { app: 'calendar' });
            }}
          >
            打开日历
          </button>
        </div>
      ) : (
        <>
          <div className={s.reading} data-scene-records>
            <section className={s.card}>
              <h3>{data.scene.title}</h3>
              <time>{worldDateTimeLabel(data.storyNow)}</time>
              <p>
                {data.scene.status === 'ended'
                  ? '已离场 · 可以回看'
                  : data.paused
                    ? '世界已暂停'
                    : data.scene.status === 'paused'
                      ? '现场已暂停'
                      : '正在现场'}
              </p>
              <div className={s.buttons}>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (data.scene!.status !== 'ended')
                        await client.navigate(worldId, data.scene!.id, {
                          commandId: crypto.randomUUID(),
                          expectedVersion: data.worldVersion,
                          view: 'phone',
                        });
                      window.location.hash = routeHash(worldId, { app: null });
                    })
                  }
                >
                  回到手机
                </button>
                {data.scene.status === 'paused' ? (
                  <button
                    disabled={busy || data.paused}
                    onClick={() =>
                      void run(async () => {
                        await client.navigate(worldId, data.scene!.id, {
                          commandId: crypto.randomUUID(),
                          expectedVersion: data.worldVersion,
                          view: 'scene',
                        });
                      })
                    }
                  >
                    返回现场
                  </button>
                ) : null}
                {data.scene.status !== 'ended' ? (
                  <button disabled={busy} onClick={() => setLeaveConfirm(true)}>
                    离开现场
                  </button>
                ) : null}
              </div>
              {leaveConfirm ? (
                <div>
                  <p>离场会停止尚未完成的现场回应，记录仍可回看。</p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await client.navigate(
                          worldId,
                          data.scene!.id,
                          {
                            commandId: crypto.randomUUID(),
                            expectedVersion: data.worldVersion,
                            view: 'phone',
                          },
                          true,
                        );
                        window.location.hash = routeHash(worldId, {
                          app: null,
                          panel: 'scene',
                          target: data.scene!.id,
                        });
                        setLeaveConfirm(false);
                      })
                    }
                  >
                    确认离场
                  </button>
                  <button onClick={() => setLeaveConfirm(false)}>留下</button>
                </div>
              ) : null}
            </section>
            {data.matters.length ? (
              <details className={s.card}>
                <summary>眼下的事 · {data.matters.length}</summary>
                <ul>
                  {data.matters.map((m) => (
                    <li key={m.id}>
                      {m.title} · {states[m.status]}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <div className={s.stream}>
              {[
                ...data.entries,
                ...data.actions
                  .filter(
                    (a) =>
                      !data.entries.some((e) => e.kind === 'user_action' && e.actionId === a.id),
                  )
                  .map((a) => ({
                    kind: 'private_input' as const,
                    id: 'input-' + a.id,
                    text: a.text,
                    sourceVersion: a.sourceVersion,
                  })),
              ]
                .sort((a, b) => a.sourceVersion - b.sourceVersion)
                .map((e) =>
                  e.kind === 'time_place' ? (
                    <div key={e.id} className={s.place}>
                      {e.location} · {worldDateTimeLabel(e.storyAt)}
                    </div>
                  ) : e.kind === 'media_reference' ? null : (
                    <article
                      key={e.id}
                      className={`${s.entry} ${e.kind === 'dialogue' ? s.dialogue : e.kind === 'user_action' || e.kind === 'private_input' ? s.user : e.kind === 'adjudicated_result' ? s.result : ''}`}
                    >
                      <small>
                        {e.kind === 'dialogue'
                          ? e.speaker.kind === 'player'
                            ? '我'
                            : name(e.speaker.actorId)
                          : e.kind === 'private_input'
                            ? '我的想法 · 仅自己可见'
                            : e.kind === 'user_action'
                              ? '我的输入'
                              : e.kind === 'adjudicated_result'
                                ? '行动结果'
                                : '眼前的情景'}
                      </small>
                      {e.text}
                    </article>
                  ),
                )}
            </div>
            {task && task.status !== 'succeeded' ? (
              <div className={s.card} role="status">
                <p>{sceneStatus(task)}</p>
                {task.status === 'queued' ? (
                  <button
                    disabled={busy || data.paused}
                    onClick={() => void run(() => execute(task))}
                  >
                    继续等待现场回应
                  </button>
                ) : null}
                {['failed', 'unknown', 'cancelled'].includes(task.status) &&
                data.scene.status === 'active' ? (
                  <button disabled={busy || data.paused} onClick={() => setRetryConfirm(true)}>
                    重试这次回应
                  </button>
                ) : null}
                {retryConfirm ? (
                  <div>
                    <p>先核对已保存记录。确认后将发起一次新的回应，可能再次产生费用。</p>
                    <button
                      disabled={busy || data.paused}
                      onClick={() =>
                        void run(async () => {
                          if (retryId.current?.taskId !== task.id)
                            retryId.current = { taskId: task.id, id: crypto.randomUUID() };
                          const t = await client.retry(task.id, retryId.current.id);
                          setTask(t);
                          setRetryConfirm(false);
                          await execute(t);
                        })
                      }
                    >
                      确认重试
                    </button>
                    <button onClick={() => setRetryConfirm(false)}>取消</button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          {data.scene.status !== 'ended' ? (
            <form
              className={s.composer}
              onSubmit={(e) => {
                e.preventDefault();
                if (disabled || !text.trim()) return;
                void run(async () => {
                  if (inputId.current?.text !== text)
                    inputId.current = {
                      text,
                      id: crypto.randomUUID(),
                      version: data.worldVersion,
                      relatedMatterIds: data.matters
                        .filter((m) => !['completed', 'abandoned'].includes(m.status))
                        .map((m) => m.id)
                        .slice(0, 8),
                    };
                  const cmd = inputId.current;
                  try {
                    sessionStorage.setItem(draftKey + ':command', JSON.stringify(cmd));
                  } catch {}
                  const receipt = await client.input(worldId, data.scene!.id, {
                    commandId: cmd.id,
                    expectedVersion: cmd.version,
                    text: cmd.text,
                    relatedMatterIds: cmd.relatedMatterIds ?? [],
                  });
                  setText('');
                  try {
                    sessionStorage.removeItem(draftKey);
                    sessionStorage.removeItem(draftKey + ':command');
                  } catch {}
                  inputId.current = undefined;
                  setTask(receipt.task);
                  if (receipt.task) await execute(receipt.task);
                });
              }}
            >
              <label htmlFor="scene-input">你想说什么，或做些什么？</label>
              <textarea
                id="scene-input"
                value={text}
                maxLength={4000}
                disabled={disabled}
                onChange={(e) => {
                  setText(e.target.value);
                  try {
                    sessionStorage.setItem(draftKey, e.target.value);
                  } catch {}
                }}
                placeholder="直接写下想法、计划或行动"
              />
              <button disabled={disabled || !text.trim()}>发送</button>
              <small className={s.notice}>结果以现场的实际回应为准。</small>
            </form>
          ) : null}
        </>
      )}
      {error ? <p role="alert">{error}</p> : null}
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await refresh();
          })
        }
      >
        重新读取现场
      </button>
    </div>
  );
}
