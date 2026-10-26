'use client';
import { isSimpleSceneQuestion } from '../../../modules/world/domain/scene-delivery.ts';
import { classifySceneInput } from '../../../modules/world/domain/scene-runtime.ts';
import { sceneTimelineEntries } from './scene-timeline.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProgressState } from '../../../components/progress-state.tsx';
import { sceneOverview } from './index-state.ts';
import { SceneClient } from './client.ts';
import {
  shouldResumeSceneTask,
  sceneBusy,
  sceneStatus,
  mergeScene,
  restoreSceneCommand,
  sceneInputDisabled,
  mergeSceneTask,
  canRetrySceneTask,
  readSceneTaskForRecovery,
  type SceneTask,
} from './state.ts';
import type { SceneRead } from '../../../contracts/scenes.ts';
import type { PhoneContact, PhonePhoto } from '../apps/types.ts';
import { worldDateTimeLabel } from '../../../modules/world/domain/display-time.ts';
import { readRoute, routeHash } from '../navigation.ts';
import s from './scenes.module.css';
import { SceneStage, SceneFace, SceneMedia } from './scene-stage.tsx';
import { visibleSceneEntries, scenePhotoUrl } from './stage-presentation.ts';
import { SceneWorldSync } from './world-sync.ts';
import { SceneReadingHandle } from './scene-reading.tsx';
const states = {
  not_started: '还未开始',
  in_progress: '正在进行',
  blocked: '遇到阻碍',
  completed: '已完成',
  abandoned: '已放下',
};
function renderStoryContent(text: string) {
  const parts = text.split(/(（[^）\n]+）|\([^)\n]+\))/g);
  if (parts.length <= 1) return text;
  return parts.map((part, index) => {
    if (
      (part.startsWith('（') && part.endsWith('）')) ||
      (part.startsWith('(') && part.endsWith(')'))
    ) {
      return (
        <span key={index} className={s.stageDirection}>
          {part}
        </span>
      );
    }
    return part;
  });
}
export function ScenePanel({
  worldId,
  contacts,
  photos = [],
  transport,
  phoneVersion = 0,
  worldSync,
  onWorldChanged,
  onBusy,
}: {
  worldId: string;
  contacts: readonly PhoneContact[];
  photos?: readonly PhonePhoto[];
  /** Explicit transport seam for development-only UI fixtures. */
  transport?: typeof fetch;
  phoneVersion?: number;
  worldSync?: SceneWorldSync;
  onWorldChanged?: (minimumVersion: number) => Promise<void>;
  onBusy?: (busy: boolean) => void;
}) {
  const client = useMemo(() => new SceneClient(transport), [worldId, transport]);
  const ownSync = useMemo(() => new SceneWorldSync(worldId), [worldId]);
  const sync = worldSync ?? ownSync;
  const [syncError, setSyncError] = useState('');
  const [data, setData] = useState<SceneRead>(),
    [task, setTask] = useState<SceneTask | null>(),
    [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [retryConfirm, setRetryConfirm] = useState(false),
    [leaveConfirm, setLeaveConfirm] = useState(false),
    [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const [readingHeight, setReadingHeight] = useState(54);
  const reading = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const restoredScene = useRef<string | undefined>(undefined);
  const followEnd = useRef(true);
  const lastEntry = useRef<string | undefined>(undefined);
  const [hasNewEntries, setHasNewEntries] = useState(false);
  const scrollToBottom = useCallback(() => {
    if (reading.current) {
      reading.current.scrollTo({
        top: reading.current.scrollHeight,
        behavior: 'smooth',
      });
      followEnd.current = true;
      setShowScrollToBottom(false);
      setHasNewEntries(false);
    }
  }, []);
  const live = useRef(true),
    running = useRef(false),
    retryId = useRef<{ taskId: string; id: string } | undefined>(undefined),
    inputId = useRef<
      { text: string; id: string; version: number; relatedMatterIds?: string[] } | undefined
    >(undefined);
  const target =
    typeof window === 'undefined' ? undefined : readRoute(window.location.hash, worldId).target;
  const draftKey = `pl-scene-draft:${worldId}:${target ?? 'current'}`;
  const acceptedRead = useRef<SceneRead | undefined>(undefined);
  const readTarget = useRef(target);
  readTarget.current = target;
  const inFlightRead = useRef<{ target: string | undefined; promise: Promise<SceneRead> } | null>(
    null,
  );
  const refresh = useCallback(() => {
    if (inFlightRead.current && inFlightRead.current.target === target)
      return inFlightRead.current.promise;
    const pending = client.read(worldId, target).then((next) => {
      if (live.current && readTarget.current === target) {
        const accepted = mergeScene(acceptedRead.current, next);
        if (accepted === next) {
          acceptedRead.current = next;
          setData(next);
          setTask((current) => mergeSceneTask(current, next.task));
        }
      }
      return next;
    });
    inFlightRead.current = { target, promise: pending };
    void pending
      .finally(() => {
        if (inFlightRead.current?.promise === pending) inFlightRead.current = null;
      })
      .catch(() => {});
    return pending;
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
    if (!data || phoneVersion <= data.worldVersion) return;
    // Consume already committed world changes; this read does not wake a model.
    void refresh().catch(() => {});
  }, [phoneVersion, refresh]);
  const photoRevision = useMemo(
    () =>
      photos
        .map((p) => `${p.id}:${p.status}:${p.url ?? ''}`)
        .sort()
        .join('|'),
    [photos],
  );
  const seenPhotos = useRef(photoRevision);
  useEffect(() => {
    if (!data?.scene || seenPhotos.current === photoRevision) return;
    seenPhotos.current = photoRevision;
    // A completed background may not advance world.version. Re-read its authorized
    // scene projection once when the existing photo feed changes, never wake a model.
    void refresh().catch(() => {});
  }, [photoRevision, data?.scene?.id, refresh]);
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
  useEffect(() => {
    if (!data || !onWorldChanged) return;
    let current = true;
    void sync
      .sync(data, phoneVersion, onWorldChanged)
      .then(() => {
        if (current) setSyncError('');
      })
      .catch(() => {
        if (current)
          setSyncError('现场记录已保存，手机记录暂未同步。重新读取即可，不必再做一次行动。');
      });
    return () => {
      current = false;
    };
  }, [data, phoneVersion, sync, onWorldChanged]);
  useEffect(() => {
    const element = reading.current;
    const id = data?.scene?.id;
    if (!element || !id) return;
    const latest = data.entries.at(-1)?.id;
    if (restoredScene.current !== id) {
      restoredScene.current = id;
      let saved: string | null = null;
      try {
        saved = sessionStorage.getItem('pl-scene-scroll:' + worldId + ':' + id);
      } catch {}
      element.scrollTop =
        saved !== null && Number.isFinite(Number(saved)) ? Number(saved) : element.scrollHeight;
      followEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 90;
      setHasNewEntries(false);
    } else if (followEnd.current) element.scrollTop = element.scrollHeight;
    else if (latest && lastEntry.current && latest !== lastEntry.current) setHasNewEntries(true);
    lastEntry.current = latest;
  }, [data, worldId]);
  useEffect(() => {
    const element = reading.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (followEnd.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [data?.scene?.id]);
  const overview = data ? sceneOverview(data) : undefined;
  const entries = data ? sceneTimelineEntries(visibleSceneEntries(data), data.actions) : [];
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
      const next = await refresh().catch(() => undefined);
      if (next && onWorldChanged)
        await sync.sync(next, phoneVersion, onWorldChanged).catch(() => {
          if (live.current)
            setSyncError('现场记录已保存，手机记录暂未同步。重新读取即可，不必再做一次行动。');
        });
      running.current = false;
      if (live.current) setBusy(false);
    }
  }
  function returnToPhone() {
    return run(async () => {
      if (data?.scene && data.scene.status !== 'ended')
        await client.navigate(worldId, data.scene.id, {
          commandId: crypto.randomUUID(),
          expectedVersion: data.worldVersion,
          view: 'phone',
        });
      window.location.hash = routeHash(worldId, { app: null });
    });
  }
  async function execute(t: SceneTask) {
    if (t.status !== 'queued') return;
    const result = await client.execute(t.id);
    if (live.current) setTask(result);
  }
  const resumedTasks = useRef(new Set<string>());
  useEffect(() => {
    if (
      !task ||
      !shouldResumeSceneTask(task, data?.paused ?? true) ||
      running.current ||
      resumedTasks.current.has(task.id)
    )
      return;
    resumedTasks.current.add(task.id);
    // The persisted queue lease arbitrates other tabs. Unknown/running/failed tasks are reads only.
    void run(() => execute(task));
  }, [task?.id, task?.status, data?.paused]);
  useEffect(() => {
    setRetryConfirm(false);
  }, [task?.id]);
  useEffect(() => {
    if (!canRetrySceneTask(task)) setRetryConfirm(false);
  }, [task?.status]);
  const disabled = sceneInputDisabled(data, task, busy);
  return (
    <div
      ref={panel}
      className={`${s.panel} ${s.scenePanel}`}
      data-immersive-scene={Boolean(data?.scene)}
      data-reading-mode={readingHeight > 71 ? 'expanded' : 'default'}
    >
      {!data ? (
        <div>
          <ProgressState
            label={error ? '现场暂时未能打开' : '正在读取现场记录'}
            busy={!error}
            detail={
              error
                ? '重新读取不会创建新的现场或再次调用模型。'
                : '读取地点、在场人物和已保存的行动。'
            }
          />
          {error ? (
            <button
              onClick={() => {
                setError('');
                void refresh().catch((e) => setError(e.message));
              }}
            >
              重新读取记录
            </button>
          ) : null}
        </div>
      ) : !data.scene ? (
        <div className={s.card}>
          <h3>还没有进入现场</h3>
          <p>可以在日历中打开已确认的约定赴约，或者在地图中选择当前所在地点直接进入现场。</p>
          <div className={s.buttons}>
            <button
              onClick={() => {
                window.location.hash = routeHash(worldId, { app: 'map' });
              }}
            >
              🗺️ 打开地图前往地点现场
            </button>
            <button
              onClick={() => {
                window.location.hash = routeHash(worldId, { app: 'calendar' });
              }}
            >
              📅 打开日历查看约定
            </button>
          </div>
        </div>
      ) : (
        <>
          {syncError ? (
            <p className={s.notice} role="status">
              {syncError}
            </p>
          ) : null}
          <SceneStage
            read={data}
            contacts={contacts}
            photos={photos}
            onSelectPerson={(person) => {
              const prefix = `对${person.name}说：`;
              setText(prefix);
              try {
                sessionStorage.setItem(draftKey, prefix);
              } catch {}
              if (inputRef.current) {
                inputRef.current.focus();
                inputRef.current.setSelectionRange(prefix.length, prefix.length);
              }
            }}
          />
          <section className={s.sceneControls} aria-label="现场导航">
            <button
              type="button"
              className={s.backBtn}
              disabled={busy}
              onClick={() => void returnToPhone()}
              aria-label="返回手机"
            >
              <span aria-hidden="true">‹</span>
            </button>
            <strong className={s.locationTitle}>
              {overview?.place?.kind === 'time_place' ? overview.place.location : data.scene.title}
            </strong>
            <button
              type="button"
              className={s.quickPhoneBtn}
              disabled={busy}
              onClick={() => void returnToPhone()}
              title="返回手机主界面"
            >
              <span aria-hidden="true">▯</span> 手机
            </button>
            <time>
              {worldDateTimeLabel(
                overview?.place?.kind === 'time_place' ? overview.place.storyAt : data.storyNow,
              )}
            </time>
            <p>
              {data.scene.status === 'ended'
                ? '已离场 · 可以回看'
                : data.paused
                  ? '世界已暂停'
                  : data.scene.status === 'paused'
                    ? '现场已暂停'
                    : '正在现场'}
            </p>
            <details className={s.sceneMenu}>
              <summary>更多</summary>
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
            </details>
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
          <div className={s.readingArea} style={{ height: `${readingHeight}%` }}>
            <SceneReadingHandle
              sceneKey={worldId + ':' + data.scene.id}
              container={panel}
              onHeight={setReadingHeight}
            />
            <div
              className={s.reading}
              data-scene-records
              ref={reading}
              onScroll={(event) => {
                const element = event.currentTarget;
                const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
                followEnd.current = distance < 90;
                setShowScrollToBottom(distance > 160);
                if (distance < 90) setHasNewEntries(false);
                if (data.scene)
                  try {
                    sessionStorage.setItem(
                      'pl-scene-scroll:' + worldId + ':' + data.scene.id,
                      String(element.scrollTop),
                    );
                  } catch {}
              }}
            >
              <div className={s.stream} aria-label="现场对话与旁白">
                {[
                  ...entries,
                  ...data.actions
                    .filter(
                      (a) => !entries.some((e) => e.kind === 'user_action' && e.actionId === a.id),
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
                      e.id === entries.find((item) => item.kind === 'time_place')?.id ? null : (
                        <div key={e.id} className={s.place}>
                          {e.location} · {worldDateTimeLabel(e.storyAt)}
                        </div>
                      )
                    ) : e.kind === 'media_reference' ? (
                      e.media.purpose === 'scene_illustration' ? null : (
                        <SceneMedia
                          key={e.id}
                          url={scenePhotoUrl(data, e.media.assetId, photos)}
                          reference
                        />
                      )
                    ) : (
                      <article
                        key={e.id}
                        className={`${s.entry} ${e.kind === 'dialogue' ? (e.speaker.kind === 'player' ? `${s.dialogue} ${s.user}` : s.dialogue) : e.kind === 'user_action' || e.kind === 'private_input' ? s.user : `${s.result} ${e.text.length > 44 || e.text.includes('\n') ? s.longNarration : s.shortNarration}`}`}
                      >
                        {e.kind === 'dialogue' && e.speaker.kind === 'actor' ? (
                          <SceneFace
                            person={contacts.find(
                              (c) => e.speaker.kind === 'actor' && c.id === e.speaker.actorId,
                            )}
                          />
                        ) : null}
                        <div className={s.entryCopy}>
                          <small>
                            {e.kind === 'dialogue'
                              ? e.speaker.kind === 'player'
                                ? '我'
                                : name(e.speaker.actorId)
                              : e.kind === 'private_input'
                                ? '心想 · 仅自己可见'
                                : e.kind === 'user_action'
                                  ? '我的举动'
                                  : e.kind === 'adjudicated_result'
                                    ? '眼前'
                                    : '现场'}
                          </small>
                          <p>{renderStoryContent(e.text)}</p>
                        </div>
                      </article>
                    ),
                  )}
              </div>
              {task && task.status !== 'succeeded' ? (
                <div className={s.card} role="status">
                  <ProgressState
                    label={sceneStatus(task)}
                    busy={sceneBusy(task)}
                    detail={sceneBusy(task) ? '正在保存现场的后续回应……' : undefined}
                  />
                  {task.status === 'queued' ? (
                    <button
                      disabled={busy || data.paused}
                      onClick={() => void run(() => execute(task))}
                    >
                      推动故事继续展开
                    </button>
                  ) : null}
                  {canRetrySceneTask(task) && data.scene.status === 'active' ? (
                    <button
                      disabled={busy || data.paused}
                      onClick={() =>
                        void run(async () => {
                          const latest = await readSceneTaskForRecovery(task, (id) =>
                            client.task(id),
                          );
                          setTask(latest);
                          setRetryConfirm(canRetrySceneTask(latest));
                        })
                      }
                    >
                      {task.status === 'unknown' ? '核对回应结果' : '重新处理这次回应'}
                    </button>
                  ) : null}
                  {retryConfirm ? (
                    <div>
                      <p>
                        {task.status === 'unknown'
                          ? '原回应的结果仍未确认，可能已经处理。重新生成可能重复回应并再次产生费用。'
                          : '行动已经保存。确认后只重新处理这次回应，不会再次发送你的行动；可能再次产生费用。'}
                      </p>
                      <button
                        disabled={busy || data.paused}
                        onClick={() =>
                          void run(async () => {
                            const latest = await readSceneTaskForRecovery(task, (id) =>
                              client.task(id),
                            );
                            setTask(latest);
                            if (!canRetrySceneTask(latest)) {
                              setRetryConfirm(false);
                              return;
                            }
                            if (retryId.current?.taskId !== task.id)
                              retryId.current = { taskId: task.id, id: crypto.randomUUID() };
                            const t = await client.retry(task.id, retryId.current.id);
                            setTask(t);
                            setRetryConfirm(false);
                            await execute(t);
                          })
                        }
                      >
                        {task.status === 'unknown' ? '仍要重新生成回应' : '确认重新处理'}
                      </button>
                      <button onClick={() => setRetryConfirm(false)}>取消</button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            {(showScrollToBottom || hasNewEntries) && (
              <button
                type="button"
                className={s.scrollToBottomBtn}
                onClick={scrollToBottom}
                aria-label="回到底部最新剧情"
              >
                <span>↓</span> {hasNewEntries ? '有新内容' : '回到最新'}
              </button>
            )}
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
                      relatedMatterIds: isSimpleSceneQuestion({
                        ...classifySceneInput(text),
                        text,
                        relatedMatterIds: [],
                      })
                        ? []
                        : data.matters
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
                  followEnd.current = true;
                  setText('');
                  try {
                    sessionStorage.removeItem(draftKey);
                    sessionStorage.removeItem(draftKey + ':command');
                  } catch {}
                  if (inputRef.current) {
                    inputRef.current.style.height = '46px';
                  }
                  inputId.current = undefined;
                  setTask(receipt.task);
                  if (receipt.task) await execute(receipt.task);
                });
              }}
            >
              {/* Dynamic Action Suggestions */}
              {(() => {
                const activeMatter = data.matters.find(
                  (m) => !['completed', 'abandoned'].includes(m.status),
                );
                const title = activeMatter?.title || '';
                const presentActors = overview?.people.filter((p) => p.kind === 'actor') ?? [];
                const firstActor = presentActors[0];
                const firstActorName = firstActor
                  ? (contacts.find((c) => c.id === firstActor.actorId)?.name ?? '在场的人')
                  : null;

                const suggestions: string[] = [];
                if (firstActorName) {
                  suggestions.push(`跟${firstActorName}打声招呼，问问近况`);
                  if (title) {
                    suggestions.push(`提一下「${title}」，听听对方怎么看`);
                  } else {
                    suggestions.push('问问眼下的情况，看接下来怎么安排');
                  }
                  if (presentActors.length > 1) {
                    const secondId = presentActors[1]?.actorId;
                    const second = secondId ? contacts.find((c) => c.id === secondId)?.name : null;
                    if (second) {
                      suggestions.push(`看向${second}，问问对方的意思`);
                    }
                  }
                  suggestions.push('四处瞅瞅，观察周围环境');
                  suggestions.push('先不吭声，看看大家怎么说');
                } else {
                  if (title) {
                    suggestions.push(`琢磨一下「${title}」，理理头绪`);
                  } else {
                    suggestions.push('在周围转转，打量一下这里的环境');
                  }
                  suggestions.push('仔细看看四周，观察有什么动静');
                  suggestions.push('找个地方坐下，稍作歇息');
                  suggestions.push('静下心来，想想接下来该做点什么');
                }
                return (
                  <details className={s.suggestions}>
                    <summary>行动灵感</summary>
                    <div className={s.suggestionRow} aria-label="行动灵感">
                      {suggestions.map((sug, idx) => (
                        <button
                          type="button"
                          key={idx}
                          className={s.suggestionPill}
                          disabled={disabled}
                          onClick={() => {
                            setText(sug);
                            try {
                              sessionStorage.setItem(draftKey, sug);
                            } catch {}
                            if (inputRef.current) {
                              inputRef.current.focus();
                              inputRef.current.style.height = '46px';
                              inputRef.current.style.height =
                                Math.min(inputRef.current.scrollHeight, 100) + 'px';
                            }
                          }}
                        >
                          {sug}
                        </button>
                      ))}
                    </div>
                  </details>
                );
              })()}

              <div className={s.composerInputRow}>
                <label className={s.srOnly} htmlFor="scene-input">
                  说点什么，或做点什么
                </label>
                <textarea
                  id="scene-input"
                  ref={inputRef}
                  value={text}
                  maxLength={4000}
                  disabled={disabled}
                  enterKeyHint="send"
                  onFocus={(e) => {
                    setTimeout(() => {
                      e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                    }, 250);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      if (!disabled && text.trim()) {
                        e.currentTarget.form?.requestSubmit();
                      }
                    }
                  }}
                  onChange={(e) => {
                    setText(e.target.value);
                    try {
                      sessionStorage.setItem(draftKey, e.target.value);
                    } catch {}
                  }}
                  onInput={(event) => {
                    event.currentTarget.style.height = '46px';
                    event.currentTarget.style.height =
                      Math.min(event.currentTarget.scrollHeight, 100) + 'px';
                  }}
                  placeholder="想说点什么，或者做个动作……"
                />
                <button disabled={disabled || !text.trim()}>发送</button>
              </div>
            </form>
          ) : null}
        </>
      )}
      {error ? <p role="alert">{error}</p> : null}
      {!data?.scene ? (
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
      ) : null}
    </div>
  );
}
