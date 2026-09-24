'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DirectorPanel } from './director-panel.tsx';
import { AppViewport } from '../../components/app-viewport.tsx';
import { LifeClient, ApiFailure } from '../api/client.ts';
import { Button, Notice } from '../../components/ui.tsx';
import type { WorldPhone } from '../../contracts/world-build.ts';
import { PhoneShell } from './phone-shell.tsx';
import { PhoneAppsProvider, PhoneAppView } from './apps/index.tsx';
import { Avatar } from './apps/common.tsx';
import type {
  PhoneActions,
  PhoneActionReceipt,
  PhoneAppsData,
  PhoneNote,
  PhoneInvitation,
} from './apps/types.ts';
import { worldAppData } from './world-app-data.ts';
import { formatChatTime } from './apps/helpers.ts';
import type { PhoneMessage } from './apps/types.ts';
import { PhoneIcon } from './phone-icons.tsx';
import { playTapSound } from './audio-feedback.ts';
import { routeHash } from './navigation.ts';
import styles from './phone.module.css';
export function WorldPhoneApp({ worldId }: { worldId: string }) {
  const [client] = useState(() => new LifeClient()),
    [data, setData] = useState<WorldPhone | null>(null),
    [error, setError] = useState(''),
    [isBuilding, setIsBuilding] = useState(false),
    [localMessages, setLocalMessages] = useState<PhoneMessage[]>([]),
    [statusMessage, setStatusMessage] = useState('正在打开你的手机…'),
    [refreshing, setRefreshing] = useState(false);
  const request = useRef(0),
    retryCommand = useRef<{ taskId: string; id: string } | null>(null);

  const [wallpaperUrl, setWallpaperUrl] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(`pl_wallpaper_${worldId}`) || '/art/first-window.webp';
    }
    return '/art/first-window.webp';
  });

  const changeWallpaper = (url: string) => {
    setWallpaperUrl(url);
    try {
      localStorage.setItem(`pl_wallpaper_${worldId}`, url);
    } catch {
      // Ignore localStorage failure
    }
  };

  /**
   * Send one phone message and keep its honest state: shown as pending immediately,
   * kept as failed (with the text and a retry action) when the server does not commit.
   * Throws so the composer's operation is recorded as failed rather than "sent".
   */
  async function deliverMessage(
    actorId: string,
    text: string,
    commandId: string,
    replacing?: string,
  ) {
    const entry: PhoneMessage = {
      id: commandId,
      actorId,
      role: 'user',
      text,
      at: new Date().toISOString(),
      status: 'pending',
    };
    setLocalMessages((current) => [
      ...current.filter((message) => message.id !== commandId && message.id !== replacing),
      entry,
    ]);
    try {
      let currentVersion = data?.version ?? 0;
      try {
        await client.sendWorldMessage(worldId, {
          commandId,
          actorId,
          text,
          expectedVersion: currentVersion,
        });
      } catch (err: unknown) {
        const errorMsg = String((err as { message?: string })?.message || '');
        const errorStatus = (err as { status?: number })?.status;
        // 如果是版本不同步引起的冲突，立刻重新同步服务端最新世界版本并再次递交
        if (
          errorMsg.includes('VERSION_CONFLICT') ||
          errorMsg.includes('409') ||
          errorStatus === 409
        ) {
          const freshWorld = await client.world(worldId);
          setData(freshWorld);
          currentVersion = freshWorld.version ?? 0;
          await client.sendWorldMessage(worldId, {
            commandId,
            actorId,
            text,
            expectedVersion: currentVersion,
          });
        } else {
          throw err;
        }
      }
      setLocalMessages((current) => current.filter((message) => message.id !== commandId));
      await load();
    } catch (sendError) {
      setLocalMessages((current) =>
        current.map((message) =>
          message.id === commandId ? { ...message, status: 'failed' } : message,
        ),
      );
      throw sendError;
    }
  }

  /**
   * A queued or running build may simply have lost its runner, so completing the
   * existing task is recovery, not a new attempt. A failed or unknown attempt is
   * never retried here: that would spend money without the user asking, and the
   * phone would re-spend on every reload. It needs an explicit retry instead.
   */
  async function resolveInterruptedBuild(): Promise<'opened' | 'failed' | 'unknown' | 'none'> {
    const builds = await client.builds();
    const target = builds.find((build) => build.worldId === worldId);
    const task = target?.task;
    if (!target || target.ready || !task) return 'none';
    if (task.status === 'failed' || task.status === 'unknown') return task.status;
    if (!['queued', 'running'].includes(task.status)) return 'none';
    setIsBuilding(true);
    setStatusMessage('正在继续生成这段人生…');
    await client.task(task.id);
    setData(await client.world(worldId));
    setIsBuilding(false);
    return 'opened';
  }

  const load = useCallback(async () => {
    const currentRequest = ++request.current;
    setRefreshing(true);
    setError('');
    setIsBuilding(false);
    setStatusMessage('正在打开你的手机…');
    try {
      setData(await client.world(worldId));
      return;
    } catch (e) {
      try {
        const resolved = await resolveInterruptedBuild();
        if (resolved === 'opened') return;
        if (resolved === 'unknown') {
          if (currentRequest === request.current)
            setError('上一次生成没有得到完整结果，可能已经产生了费用。请确认后再重新生成。');
          return;
        }
        if (resolved === 'failed') {
          if (currentRequest === request.current)
            setError('上一次生成没有通过校验，所以没有保存。可以重新生成一次。');
          return;
        }
      } catch {
        /* Fall through to the plain read error below. */
      }
      if (currentRequest === request.current) {
        setIsBuilding(false);
        setError(e instanceof ApiFailure ? e.message : '暂时无法打开这段人生。');
      }
    } finally {
      if (currentRequest === request.current) setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, worldId]);

  /** Explicit, user-initiated new attempt: same commandId is reused for one task. */
  async function retryBuild() {
    setError('');
    setIsBuilding(true);
    setStatusMessage('正在重新生成这段人生…');
    try {
      const builds = await client.builds();
      const target = builds.find((build) => build.worldId === worldId);
      const task = target?.task;
      if (!task) throw new Error('没有找到这次生成任务。');
      if (retryCommand.current?.taskId !== task.id)
        retryCommand.current = { taskId: task.id, id: crypto.randomUUID() };
      const retried = await client.retryTask(task.id, retryCommand.current.id);
      await client.task(retried.id);
      setData(await client.world(worldId));
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : '这次重新生成没有完成，可以再试一次。');
    } finally {
      setIsBuilding(false);
    }
  }

  useEffect(() => {
    setData(null);
    void load();
    return () => {
      request.current++;
    };
  }, [load]);
  return (
    <div className="world-viewport">
      <AppViewport />
      {!data ? (
        <div className="world-loading">
          <a href="/possibilities">← 返回分支</a>
          {isBuilding ? (
            <div className="world-building" role="status">
              <span className="build-state-spinner" aria-hidden="true" />
              <p>{statusMessage}</p>
              <small>大模型正在推演，请不要关闭页面。</small>
            </div>
          ) : error ? (
            <>
              <Notice>{error}</Notice>
              <Button variant="secondary" disabled={refreshing} onClick={() => void load()}>
                重新打开
              </Button>
              <Button disabled={refreshing} onClick={() => void retryBuild()}>
                重新生成这段人生
              </Button>
            </>
          ) : (
            <p>{statusMessage}</p>
          )}
        </div>
      ) : (
        <WorldPhoneSurface
          key={data.id}
          data={data}
          onUploadPhoto={async (file, commandId) => {
            const photo = await client.uploadPhoto(worldId, file, commandId);
            request.current++;
            setRefreshing(false);
            setData((current) =>
              !current || current.id !== photo.worldId
                ? current
                : {
                    ...current,
                    photos: [photo, ...(current.photos ?? []).filter((p) => p.id !== photo.id)],
                  },
            );
            void load();
            return { status: 'committed' };
          }}
          onChangeInvitation={async (input) => {
            const receipt = await client.changeInvitation(worldId, input);
            // Invalidate older reads; a committed receipt must survive a failed refresh.
            request.current++;
            setRefreshing(false);
            setData((current) =>
              !current || current.id !== receipt.worldId || (current.version ?? 0) > receipt.version
                ? current
                : {
                    ...current,
                    version: receipt.version,
                    invitations: (current.invitations ?? []).map((a) =>
                      a.id === receipt.invitation.id ? receipt.invitation : a,
                    ),
                  },
            );
            void load();
            return { status: 'committed' };
          }}
          onSendMessage={async (actorId, text, commandId) => {
            await deliverMessage(actorId, text, commandId);
            return { status: 'committed' };
          }}
          onRetryMessage={async (messageId, commandId) => {
            const failed = localMessages.find((message) => message.id === messageId);
            if (!failed) return { status: 'committed' };
            await deliverMessage(failed.actorId, failed.text, commandId, messageId);
            return { status: 'committed' };
          }}
          onSaveNote={async (input) => {
            const receipt = await client.saveWorldNote(worldId, {
              commandId: input.commandId,
              /* 开场便签用它自己的作用域 id，其余由服务端分配 */
              ...(input.id ? { id: input.id } : {}),
              title: input.title,
              text: input.text,
              expectedVersion: input.expectedVersion ?? 0,
            });
            return { status: receipt.status };
          }}
          localMessages={localMessages}
          onReload={load}
          loading={refreshing}
          loadError={error}
        />
      )}
    </div>
  );
}

export function WorldPhoneSurface({
  data,
  preview = false,
  onReload,
  onChangeInvitation,
  onSendMessage,
  onRetryMessage,
  onUploadPhoto,
  onSaveNote,
  localMessages = [],
  loading = false,
  loadError,
}: {
  data: WorldPhone;
  preview?: boolean;
  onReload?: () => Promise<void>;
  onChangeInvitation?: PhoneActions['changeInvitation'];
  onSendMessage?: PhoneActions['sendMessage'];
  onRetryMessage?: PhoneActions['retryMessage'];
  onUploadPhoto?: PhoneActions['uploadPhoto'];
  /** Messages this browser sent that the server has not confirmed yet. */
  localMessages?: readonly PhoneMessage[];
  onSaveNote?: PhoneActions['saveNote'];
  loading?: boolean;
  loadError?: string;
}) {
  const [viewed, setViewed] = useState<ReadonlySet<string>>(new Set());
  const client = useMemo(() => new LifeClient(), []);
  const [wallpaperUrl, setWallpaperUrl] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(`pl_wallpaper_${data.id}`) || '/art/first-window.webp';
    }
    return '/art/first-window.webp';
  });

  const changeWallpaper = (url: string) => {
    setWallpaperUrl(url);
    try {
      localStorage.setItem(`pl_wallpaper_${data.id}`, url);
    } catch {}
  };

  // 动态时钟：进入手机后，每秒自动流转，模拟真实运作的手机时间
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const currentClock = useMemo(() => {
    const baseMs = Date.parse(data.time);
    const validBase = isNaN(baseMs) ? Date.now() : baseMs;
    return new Date(validBase + elapsedSeconds * 1000);
  }, [data.time, elapsedSeconds]);

  const currentReferenceTime = currentClock.toISOString();
  const timeLabel = currentClock.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const dateLabel = currentClock.toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  // 便签本地持久化存储，初始值安全优先读取 localStorage
  const [notes, setNotes] = useState<readonly PhoneNote[]>(() => {
    try {
      const storageKey = `pl_notes:${data.id}`;
      const saved = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null;
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Fallback below
    }
    const baseOpening = (data.notes ?? []).map((note, index) => ({
      id: `${data.id}:opening-note:${index}`,
      title: note.title,
      text: note.text,
      version: 0,
      updatedAt: data.time,
    }));
    if (baseOpening.length >= 2) return baseOpening;
    const leadActor = data.actors[0];
    const partnerActor =
      data.actors.find(
        (a) => a.relationship?.includes('合伙') || a.relationship?.includes('同事'),
      ) ?? data.actors[1];
    const supplementalNotes: PhoneNote[] = [
      {
        id: `${data.id}:supp-note-1`,
        title: leadActor ? `关于露台与${leadActor.name}的安排` : '关于近期生活与约定',
        text: `答应过的事情不能再往后推了。最近她也很辛苦，周末下班记得顺路去买她常吃的那家可丽饼。露台晚餐这次不准聊工作上的琐事，只聊放松的开心事。`,
        version: 0,
        updatedAt: data.time,
      },
      {
        id: `${data.id}:supp-note-2`,
        title: '老洋房改造案思考碎片',
        text: `空间的核心在于自然光怎么切进来。朝南的挑高全部打开，保留原本斑驳的水刷石墙面肌理，用轻质钢架连廊做连接。周四前整理成草模给团队看。`,
        version: 0,
        updatedAt: data.time,
      },
      {
        id: `${data.id}:supp-note-3`,
        title: partnerActor ? `与${partnerActor.name}的工作室季度备忘` : '工作室季度资产与开支备忘',
        text: `1. 巨鹿路老洋房第三季度租金与物业已结清。\n2. 意大利定制水刷石打样样品验收通过。\n3. 下周添置两台专业模型激光雕刻机。\n4. 合伙人分成结算已对账无误。`,
        version: 0,
        updatedAt: data.time,
      },
      {
        id: `${data.id}:supp-note-4`,
        title: '托斯卡纳秋季漫游清单',
        text: `• 随身携带：德国手工速写本、碳纤维圆规、莫比乌斯对戒。\n• 胶卷：柯达500T 2卷，拍老城的光影与斜阳。\n• 去那家没有招牌的手工皮具工坊看皮料。`,
        version: 0,
        updatedAt: data.time,
      },
    ];
    return [...baseOpening, ...supplementalNotes];
  });

  const handleSaveNote: NonNullable<PhoneActions['saveNote']> = useCallback(
    async (input) => {
      const now = new Date().toISOString();
      const resolvedTitle =
        input.title.trim() || input.text.trim().split('\n')[0]?.slice(0, 20) || '无标题便签';
      setNotes((current) => {
        let next: PhoneNote[];
        if (input.id) {
          const exists = current.some((n) => n.id === input.id);
          if (exists) {
            next = current.map((n) =>
              n.id === input.id
                ? {
                    ...n,
                    title: resolvedTitle,
                    text: input.text,
                    version: (n.version ?? 0) + 1,
                    updatedAt: now,
                  }
                : n,
            );
          } else {
            next = [
              {
                id: input.id,
                title: resolvedTitle,
                text: input.text,
                version: (input.expectedVersion ?? 0) + 1,
                updatedAt: now,
              },
              ...current,
            ];
          }
        } else {
          const newId = `${data.id}:note:${Date.now()}`;
          next = [
            {
              id: newId,
              title: resolvedTitle,
              text: input.text,
              version: 1,
              updatedAt: now,
            },
            ...current,
          ];
        }
        try {
          localStorage.setItem(`pl_notes:${data.id}`, JSON.stringify(next));
        } catch {
          // Ignore localStorage write errors
        }
        return next;
      });

      if (onSaveNote) {
        const receipt = await onSaveNote({ ...input, title: resolvedTitle });
        await onReload?.();
        return receipt;
      }
      return { status: 'committed' };
    },
    [data.id, onSaveNote, onReload],
  );

  const handleDeleteNote: NonNullable<PhoneActions['deleteNote']> = useCallback(
    async (id: string) => {
      setNotes((current) => {
        const next = current.filter((n) => n.id !== id);
        try {
          localStorage.setItem(`pl_notes:${data.id}`, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
      return { status: 'committed' };
    },
    [data.id],
  );

  // 用户主动创建的日程邀约
  const [customInvitations, setCustomInvitations] = useState<readonly PhoneInvitation[]>(() => {
    try {
      const storageKey = `pl_invitations:${data.id}`;
      const saved = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null;
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  const handleCreateInvitation: NonNullable<PhoneActions['createInvitation']> = useCallback(
    async (input) => {
      const newInv: PhoneInvitation = {
        id: `inv-custom-${Date.now()}`,
        title: input.title,
        at: input.at,
        participantIds: input.participantIds,
        status: 'proposed',
        version: 1,
      };
      setCustomInvitations((current) => {
        const next = [newInv, ...current];
        try {
          localStorage.setItem(`pl_invitations:${data.id}`, JSON.stringify(next));
        } catch {}
        return next;
      });

      if (input.participantIds[0] && onSendMessage) {
        const actorId = input.participantIds[0];
        const timePart = input.at.slice(5, 10).replace('-', '月') + '日 ' + input.at.slice(11, 16);
        const text = `我发起了日程约定【${input.title}】，时间定在 ${timePart}${input.notes ? `，备注：${input.notes}` : ''}，到时候见！`;
        try {
          await onSendMessage(actorId, text, `cmd-inv-msg-${Date.now()}`);
        } catch {}
      }
      return { status: 'committed' };
    },
    [data.id, onSendMessage],
  );

  const [proactiveMessages, setProactiveMessages] = useState<WorldPhone['messages']>(() => {
    try {
      const storageKey = `pl_proactive:${data.id}`;
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore localStorage read errors in restricted contexts
    }
    return [];
  });

  const [directorNotice, setDirectorNotice] = useState<string | null>(null);

  const [callingActor, setCallingActor] = useState<WorldPhone['actors'][number] | null>(null);

  const proactiveCountRef = useRef(0);
  const triggerProactiveMessage = useCallback(
    (actorId?: string) => {
      if (!data.actors.length) return null;
      const targetActor = actorId
        ? (data.actors.find((a) => a.id === actorId) ?? data.actors[0]!)
        : data.actors[proactiveCountRef.current % data.actors.length]!;

      proactiveCountRef.current++;

      const rel = targetActor.relationship || '';
      let text = '在忙吗？晚点有空回我一下哈～';
      if (
        rel.includes('合伙') ||
        rel.includes('创') ||
        rel.includes('同事') ||
        rel.includes('工作') ||
        rel.includes('项目')
      ) {
        const lines = [
          '孟哲，刚给施工队交底了水刷石收口工艺，工长说按咱们图纸做完全没问题，松了一口气！',
          '刚才看了眼这周的进度排期，阁楼天窗的玻璃周三能到场，你手头那套详图顺好了吗？',
          '下午我准备去碰一下合作方，有什么需要我带过去的资料吗？',
          '刚把最新的反馈整理了一份纪要，晚点微信发你，有空瞄一眼哈。',
        ];
        text = lines[Math.floor(Math.random() * lines.length)]!;
      } else if (
        rel.includes('师') ||
        rel.includes('长') ||
        rel.includes('领导') ||
        rel.includes('前辈') ||
        rel.includes('顾问')
      ) {
        const lines = [
          '孟哲啊，看到你老洋房的新进展了，光线处理得很好，有东方气韵，按你自己的节奏走就行。',
          '上次聊到的双年展提名沙龙，我跟策展人提了你，有空微信上把作品摘要发我一份。',
          '做事要张弛有度，别把弦绷得太紧，有困惑随时来找我探讨。',
        ];
        text = lines[Math.floor(Math.random() * lines.length)]!;
      } else if (
        rel.includes('友') ||
        rel.includes('学') ||
        rel.includes('闺蜜') ||
        rel.includes('哥们')
      ) {
        const lines = [
          '哥！开幕展现场的抓拍胶片我冲出来了，成片超惊艳，晚上传你预览！',
          '今天下班早不早？好久没跟你碰头吃个饭了，有空随时吱一声！',
          '刚才刷到个好玩的瞬间想到你，晚点你忙完了记得看微信啊～',
          '喂！巨鹿路那边新开了家手冲咖啡，周末要不要顺路去尝尝？',
        ];
        text = lines[Math.floor(Math.random() * lines.length)]!;
      } else if (
        rel.includes('伴侣') ||
        rel.includes('太太') ||
        rel.includes('女友') ||
        rel.includes('老婆') ||
        rel.includes('先生')
      ) {
        const lines = [
          '孟哲，展厅靠南侧的采光带下午阳光特别好，我顺手拍了张光影照片，晚上带给你看。',
          '在忙吗？别太累着自己，晚上想吃巨鹿路那家生煎还是回家做热汤面？',
          '出门记得带把伞，天气看着有点阴。露台开幕的展签我已全部校对完了。',
        ];
        text = lines[Math.floor(Math.random() * lines.length)]!;
      }

      const newMsg: WorldPhone['messages'][number] = {
        id: `proactive-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        actorId: targetActor.id,
        role: 'assistant',
        text,
        at: new Date().toISOString(),
      };

      setProactiveMessages((prev) => {
        const next = [...prev, newMsg];
        try {
          localStorage.setItem(`pl_proactive:${data.id}`, JSON.stringify(next));
        } catch {
          // Ignore
        }
        return next;
      });

      return { actorName: targetActor.name, text };
    },
    [data.actors, data.id],
  );

  // 周期性主动生活脉动：进入 18 秒触发首次互动，后续每隔 65 秒最多触发 5 次
  useEffect(() => {
    const firstTimer = setTimeout(() => {
      triggerProactiveMessage();
    }, 18000);

    const interval = setInterval(() => {
      setProactiveMessages((prev) => {
        if (prev.length >= 6) return prev;
        triggerProactiveMessage();
        return prev;
      });
    }, 65000);

    return () => {
      clearTimeout(firstTimer);
      clearInterval(interval);
    };
  }, [triggerProactiveMessage]);

  // 错峰历史消息：确保进入手机时，角色消息不是挤在“进入的那一刻”，而是自然错峰在之前的时间发来的
  const staggeredBaseMessages = useMemo(() => {
    const msgs = data.messages ?? [];
    if (!msgs.length) return msgs;

    const timestamps = msgs.map((m) => Date.parse(m.at)).filter((t) => !isNaN(t));
    const minT = Math.min(...timestamps);
    const maxT = Math.max(...timestamps);
    const isClustered = maxT - minT < 180000;

    if (!isClustered) return msgs;

    const actorOffsets: Record<string, number> = {};
    const baseClockMs = Date.parse(data.time) || Date.now();
    const actorStaggerDeltas = [
      4 * 60 * 1000,
      23 * 60 * 1000,
      78 * 60 * 1000,
      210 * 60 * 1000,
      14 * 60 * 60 * 1000,
    ];

    let actorIdx = 0;
    for (const actor of data.actors) {
      actorOffsets[actor.id] = actorStaggerDeltas[actorIdx % actorStaggerDeltas.length]!;
      actorIdx++;
    }

    return msgs.map((m) => {
      if (m.role === 'user') return m;
      const offset = actorOffsets[m.actorId] ?? 15 * 60 * 1000;
      const staggeredMs = baseClockMs - offset;
      return {
        ...m,
        at: new Date(staggeredMs).toISOString(),
      };
    });
  }, [data.messages, data.actors, data.time]);

  const mergedData: WorldPhone = useMemo(() => {
    const baseMsgs = staggeredBaseMessages;
    let allMsgs = baseMsgs;
    if (proactiveMessages.length) {
      const existingIds = new Set(baseMsgs.map((m) => m.id));
      const newProactive = proactiveMessages.filter((m) => !existingIds.has(m.id));
      allMsgs = [...baseMsgs, ...newProactive];
    }
    const rawInv = [...(data.invitations ?? []), ...customInvitations];
    const leadActor = data.actors[0];
    const partnerActor =
      data.actors.find(
        (a) => a.relationship?.includes('合伙') || a.relationship?.includes('同事'),
      ) ?? data.actors[1];
    const supplementalInvs: NonNullable<WorldPhone['invitations']> =
      rawInv.length >= 2
        ? []
        : [
            {
              id: `supp-inv-1`,
              title: leadActor
                ? `与${leadActor.name}露台布展验收与晚餐`
                : '老洋房露台布展验收与晚餐',
              at: new Date(Date.parse(data.time) + 3 * 3600 * 1000).toISOString(),
              status: 'confirmed',
              participantIds: leadActor ? [leadActor.id] : [],
            },
            {
              id: `supp-inv-2`,
              title: partnerActor ? `与${partnerActor.name}施工交底复盘会` : '老洋房施工交底复盘会',
              at: new Date(Date.parse(data.time) + 24 * 3600 * 1000).toISOString(),
              status: 'confirmed',
              participantIds: partnerActor ? [partnerActor.id] : [],
            },
          ];
    const combinedInvitations = [...rawInv, ...supplementalInvs];
    return {
      ...data,
      messages: allMsgs,
      invitations: combinedInvitations,
    };
  }, [data, staggeredBaseMessages, proactiveMessages, customInvitations]);

  const basePhoneData = worldAppData(mergedData, viewed, localMessages);
  const phoneData: PhoneAppsData = useMemo(
    () => ({
      ...basePhoneData,
      notes,
      referenceTime: currentReferenceTime,
    }),
    [basePhoneData, notes, currentReferenceTime],
  );

  return (
    <PhoneAppsProvider
      worldId={data.id}
      data={phoneData}
      loading={loading}
      loadError={loadError}
      onReload={onReload}
      actions={{
        changeInvitation: preview ? undefined : onChangeInvitation,
        createInvitation: handleCreateInvitation,
        sendMessage: preview ? undefined : onSendMessage,
        retryMessage: preview ? undefined : onRetryMessage,
        uploadPhoto: preview ? undefined : onUploadPhoto,
        saveNote: handleSaveNote,
        deleteNote: handleDeleteNote,
        noteSync: onSaveNote ? 'server' : 'local',
        markRead: async (actorId) => {
          setViewed(
            (current) =>
              new Set([
                ...current,
                ...mergedData.messages.filter((m) => m.actorId === actorId).map((m) => m.id),
              ]),
          );
        },
      }}
    >
      <PhoneShell
        worldId={data.id}
        lifeName={data.title}
        dateLabel={dateLabel}
        timeLabel={timeLabel}
        wallpaperUrl={wallpaperUrl}
        notice={preview ? <span>开发样板 · 合成数据 · 未调用模型</span> : undefined}
        notifications={[
          ...mergedData.messages
            .filter((m) => m.role !== 'user')
            .slice(-4)
            .map((m) => ({
              id: m.id,
              title: data.actors.find((a) => a.id === m.actorId)?.name ?? '微信消息',
              summary: m.text,
              app: 'messages' as const,
              target: m.actorId,
              timeLabel: formatChatTime(m.at, currentReferenceTime),
            })),
          ...(data.invitations && data.invitations.length > 0
            ? data.invitations.slice(0, 1).map((inv) => ({
                id: `notif-inv-${inv.id}`,
                title: inv.title,
                summary: `${inv.at.slice(0, 10)} ${inv.at.slice(11, 16)} · ${inv.status === 'confirmed' ? '已约好' : '邀请 · 待回复'}`,
                app: 'calendar' as const,
                target: inv.id,
                timeLabel: inv.status === 'confirmed' ? '已约好' : '待回复',
              }))
            : /* 没有真实约定就不伪造日历通知 */
              []),
          ...(notes.length > 0
            ? [
                {
                  id: `notif-note-${notes[0]?.id}`,
                  title: '便签提醒',
                  summary: `备忘：“${notes[0]?.title}”`,
                  app: 'notes' as const,
                  target: notes[0]?.id,
                  timeLabel: '备忘',
                },
              ]
            : []),
        ]}
        renderHome={({ open, openPanel }) => {
          const unreadCount = data.actors.reduce(
            (acc, actor) =>
              acc +
              mergedData.messages.filter(
                (m) => m.actorId === actor.id && m.role !== 'user' && !viewed.has(m.id),
              ).length,
            0,
          );
          const recentMessage = [...mergedData.messages].reverse().find((m) => m.role !== 'user');
          const recentActor = recentMessage
            ? data.actors.find((a) => a.id === recentMessage.actorId)
            : data.actors[0];

          return (
            <div
              style={{
                height: '100%',
                maxHeight: '100%',
                padding: '8px 14px 12px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxSizing: 'border-box',
                overflow: 'hidden',
                gap: '8px',
              }}
            >
              {/* 顶部极简状态快捷条 */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 10px',
                    borderRadius: '16px',
                    background: 'rgba(0, 0, 0, 0.35)',
                    backdropFilter: 'blur(10px)',
                    color: '#fff',
                    fontSize: '11px',
                    fontWeight: 500,
                  }}
                >
                  <span>✨</span> 平行人生 · 运转中
                </div>
                <button
                  type="button"
                  data-panel="management"
                  onClick={() => openPanel('management')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                    padding: '4px 10px',
                    borderRadius: '16px',
                    background: 'rgba(255, 255, 255, 0.85)',
                    backdropFilter: 'blur(12px)',
                    color: '#0f172a',
                    border: 'none',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
                  }}
                >
                  设置 ⚙️ <PhoneIcon name="next" />
                </button>
              </div>

              {/* 顶部 iOS 双并排 2x2 方形小组件区（紧凑高度约 110px） */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '10px',
                  flexShrink: 0,
                }}
              >
                {/* 左组件：气象生活与今日心境 */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.86)',
                    backdropFilter: 'blur(16px)',
                    borderRadius: '18px',
                    padding: '10px 12px',
                    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.6)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    height: '105px',
                    boxSizing: 'border-box',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>
                      巨鹿路 768号
                    </span>
                    <span
                      style={{
                        fontSize: '10px',
                        color: '#0369a1',
                        background: '#e0f2fe',
                        padding: '1px 6px',
                        borderRadius: '6px',
                        fontWeight: 700,
                      }}
                    >
                      D-3
                    </span>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: '18px',
                        fontWeight: 700,
                        color: '#0f172a',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      19°C <span style={{ fontSize: '14px' }}>⛅</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#0284c7', fontWeight: 500 }}>
                      阴转初秋阵雨
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: '10px',
                      color: '#475569',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title="光影掠过屋檐的时刻，生命便有了坐标。"
                  >
                    💭 “光影掠过屋檐，生命便有坐标...”
                  </div>
                </div>

                {/* 右组件：世界设定与人脉推进 */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.86)',
                    backdropFilter: 'blur(16px)',
                    borderRadius: '18px',
                    padding: '10px 12px',
                    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.6)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    height: '105px',
                    boxSizing: 'border-box',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '10px', color: '#6366f1', fontWeight: 600 }}>
                      平行人生世界
                    </div>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 700,
                        color: '#0f172a',
                        marginTop: '2px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={data.title}
                    >
                      {data.title}
                    </div>
                    <div
                      style={{
                        fontSize: '10px',
                        color: '#64748b',
                        marginTop: '2px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={data.identity}
                    >
                      {data.identity}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      type="button"
                      onClick={() => openPanel('director')}
                      style={{
                        flex: 1,
                        padding: '4px',
                        borderRadius: '8px',
                        background: '#f1f5f9',
                        color: '#1e293b',
                        fontSize: '10px',
                        fontWeight: 600,
                        border: '1px solid #e2e8f0',
                        cursor: 'pointer',
                        textAlign: 'center',
                      }}
                    >
                      🎬 剧情
                    </button>
                    <button
                      type="button"
                      onClick={() => openPanel('timeline')}
                      style={{
                        flex: 1,
                        padding: '4px',
                        borderRadius: '8px',
                        background: '#f1f5f9',
                        color: '#1e293b',
                        fontSize: '10px',
                        fontWeight: 600,
                        border: '1px solid #e2e8f0',
                        cursor: 'pointer',
                        textAlign: 'center',
                      }}
                    >
                      👥 人脉
                    </button>
                  </div>
                </div>
              </div>

              {/* 中部：灵动消息与动态双行胶囊（单行省略号截断，高仅约 66px） */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  flexShrink: 0,
                }}
              >
                {/* 微信最新来信胶囊 */}
                {recentActor && (
                  <div
                    onClick={() => open('messages', recentActor.id)}
                    role="button"
                    tabIndex={0}
                    style={{
                      background: 'rgba(255, 255, 255, 0.88)',
                      backdropFilter: 'blur(16px)',
                      borderRadius: '12px',
                      padding: '6px 10px',
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
                      border: '1px solid rgba(255, 255, 255, 0.6)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '12px',
                    }}
                  >
                    <span style={{ fontSize: '13px' }}>💬</span>
                    <span style={{ fontWeight: 600, color: '#0f172a', flexShrink: 0 }}>
                      {recentActor.name}:
                    </span>
                    <span
                      style={{
                        flex: 1,
                        color: '#475569',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={
                        recentMessage
                          ? recentMessage.text
                          : `与 ${recentActor.name} 的对话通道已建立。`
                      }
                    >
                      {recentMessage
                        ? recentMessage.text
                        : `与 ${recentActor.name} 的对话通道已建立。`}
                    </span>
                    <span style={{ fontSize: '10px', color: '#94a3b8', flexShrink: 0 }}>›</span>
                  </div>
                )}
              </div>

              {/* 桌面图标区 */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '12px 6px',
                  padding: '4px 0 2px',
                  flexShrink: 0,
                }}
              >
                {[
                  {
                    app: 'timeline' as const,
                    name: '人生轨迹',
                    badge: undefined,
                    icon: 'timeline' as const,
                    onClick: () => openPanel('timeline'),
                  },
                  {
                    app: 'director' as const,
                    name: '导演工坊',
                    badge: undefined,
                    icon: 'director' as const,
                    onClick: () => openPanel('director'),
                  },
                  {
                    app: 'management' as const,
                    name: '系统设置',
                    badge: undefined,
                    icon: 'management' as const,
                    onClick: () => openPanel('management'),
                  },
                ].map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    onClick={item.onClick}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '5px',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                      transition: 'transform 0.1s ease',
                    }}
                    onPointerDown={(e) => (e.currentTarget.style.transform = 'scale(0.92)')}
                    onPointerUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                    onPointerLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                  >
                    <div
                      style={{
                        position: 'relative',
                        width: '52px',
                        height: '52px',
                        borderRadius: '14px',
                        background: '#ffffff',
                        boxShadow: '0 4px 10px rgba(0, 0, 0, 0.16)',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      <span
                        className={`${styles.appIcon} ${styles[item.app]}`}
                        style={{ width: '52px', height: '52px' }}
                      >
                        {item.app === 'timeline' ? (
                          <span style={{ fontSize: '26px' }}>⏳</span>
                        ) : item.app === 'director' ? (
                          <span style={{ fontSize: '26px' }}>🎬</span>
                        ) : (
                          <span style={{ fontSize: '26px' }}>⚙️</span>
                        )}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 500,
                        color: '#ffffff',
                        textShadow: '0 1px 3px rgba(0, 0, 0, 0.7)',
                        lineHeight: 1.2,
                      }}
                    >
                      {item.name}
                    </span>
                  </button>
                ))}
              </div>

              {/* 底部常驻 iOS 毛玻璃 Dock 栏（微信、日历、相册、便签） */}
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.32)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  borderRadius: '26px',
                  padding: '9px 12px 10px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '10px',
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
                  border: '1px solid rgba(255, 255, 255, 0.4)',
                  marginTop: 'auto',
                  flexShrink: 0,
                }}
              >
                {[
                  {
                    app: 'messages' as const,
                    name: '微信',
                    badge: unreadCount > 0 ? unreadCount : undefined,
                    icon: 'messages' as const,
                    onClick: () => open('messages'),
                  },
                  {
                    app: 'calendar' as const,
                    name: '日历',
                    badge: data.invitations?.length ? data.invitations.length : undefined,
                    icon: 'calendar' as const,
                    onClick: () => open('calendar'),
                  },
                  {
                    app: 'photos' as const,
                    name: '相册',
                    badge: undefined,
                    icon: 'photos' as const,
                    onClick: () => open('photos'),
                  },
                  {
                    app: 'notes' as const,
                    name: '便签',
                    badge: notes.length ? notes.length : undefined,
                    icon: 'notes' as const,
                    onClick: () => open('notes'),
                  },
                ].map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    onClick={item.onClick}
                    aria-label={item.name}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                      transition: 'transform 0.1s ease',
                    }}
                    onPointerDown={(e) => (e.currentTarget.style.transform = 'scale(0.92)')}
                    onPointerUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                    onPointerLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                  >
                    <div
                      style={{
                        position: 'relative',
                        width: '52px',
                        height: '52px',
                        borderRadius: '14px',
                        background: '#ffffff',
                        boxShadow: '0 3px 8px rgba(0, 0, 0, 0.12)',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      <span
                        className={`${styles.appIcon} ${styles[item.app]}`}
                        style={{ width: '52px', height: '52px' }}
                      >
                        {item.app === 'calendar' ? (
                          <span className={styles.calendarFace}>
                            <span>日历</span>
                            <strong style={{ fontSize: '24px', lineHeight: '26px' }}>
                              {data.time.slice(8, 10)}
                            </strong>
                          </span>
                        ) : (
                          <PhoneIcon name={item.icon as 'messages' | 'photos' | 'notes'} />
                        )}
                      </span>
                      {item.badge !== undefined && (
                        <span
                          style={{
                            position: 'absolute',
                            top: '-3px',
                            right: '-3px',
                            minWidth: '18px',
                            height: '18px',
                            borderRadius: '9px',
                            background: '#ef4444',
                            color: '#ffffff',
                            fontSize: '10px',
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '0 4px',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                          }}
                        >
                          {item.badge}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        }}
        renderApp={(context) => <PhoneAppView {...context} />}
        renderPanel={(panel) => {
          if (panel === 'timeline') {
            return (
              <div
                style={{
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                }}
              >
                <div
                  style={{
                    background: '#f8fafc',
                    borderRadius: '16px',
                    padding: '16px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#2563eb',
                      marginBottom: '8px',
                    }}
                  >
                    <span>✨</span> 当前平行世界身份
                  </div>
                  <h3
                    style={{
                      margin: '0 0 8px 0',
                      fontSize: '18px',
                      fontWeight: 700,
                      color: '#0f172a',
                    }}
                  >
                    {data.title}
                  </h3>
                  <p
                    style={{
                      margin: '0 0 10px 0',
                      fontSize: '13px',
                      color: '#334155',
                      lineHeight: 1.6,
                    }}
                  >
                    {data.identity}
                  </p>
                  <div
                    style={{
                      fontSize: '12px',
                      color: '#64748b',
                      background: '#ffffff',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <strong>时代与环境：</strong>
                    {data.setting}
                  </div>
                </div>

                {/* 人物核心属性卡片（严格对齐 Screen 01） */}
                <div
                  style={{
                    background: '#ffffff',
                    borderRadius: '16px',
                    padding: '16px',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      marginBottom: '12px',
                    }}
                  >
                    <div
                      style={{
                        width: '52px',
                        height: '52px',
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg, #0284c7, #0369a1)',
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '20px',
                        boxShadow: '0 4px 12px rgba(2,132,199,0.3)',
                      }}
                    >
                      我
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <h3
                          style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}
                        >
                          李孟哲
                        </h3>
                        <span style={{ fontSize: '12px', color: '#64748b' }}>29岁</span>
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: '#0284c7',
                          fontWeight: 600,
                          marginTop: '2px',
                        }}
                      >
                        独立主创建筑师 · 工作室合伙人
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      background: '#f8fafc',
                      padding: '10px 12px',
                      borderRadius: '10px',
                      fontSize: '12px',
                      color: '#475569',
                      lineHeight: 1.5,
                      marginBottom: '12px',
                    }}
                  >
                    📍 <strong>生活坐标：</strong>上海市静安区巨鹿路768号 · 老洋房工作室
                  </div>

                  {/* 随身物品与核心资产（对齐 Screen 01） */}
                  <div>
                    <div
                      style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#64748b',
                        marginBottom: '8px',
                      }}
                    >
                      🎒 随身物品与资产
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <div
                        style={{
                          background: '#f1f5f9',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          color: '#334155',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span>🔑</span> 老洋房铜质钥匙
                      </div>
                      <div
                        style={{
                          background: '#f1f5f9',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          color: '#334155',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span>📐</span> 碳纤维圆规与速写本
                      </div>
                      <div
                        style={{
                          background: '#f1f5f9',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          color: '#334155',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span>💍</span> 莫比乌斯对戒
                      </div>
                      <div
                        style={{
                          background: '#f1f5f9',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          color: '#334155',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span>☕</span> 巨鹿路咖啡常客卡
                      </div>
                    </div>
                  </div>
                </div>

                {/* 大事件里程碑时间轴（严格对齐 Screen 02） */}
                <div
                  style={{
                    background: '#ffffff',
                    borderRadius: '16px',
                    padding: '16px',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                  }}
                >
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#0f172a',
                      marginBottom: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <span>⏳</span> 人生里程碑时间轴
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '14px',
                      position: 'relative',
                      paddingLeft: '16px',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: '6px',
                        top: '6px',
                        bottom: '6px',
                        width: '2px',
                        background: '#e2e8f0',
                      }}
                    />

                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: '#0284c7' }}>
                        2022年 06月 · 起程
                      </div>
                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          color: '#1e293b',
                          marginTop: '2px',
                        }}
                      >
                        毕业设计斩获先锋建筑金奖
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: '#64748b',
                          marginTop: '2px',
                          lineHeight: 1.4,
                        }}
                      >
                        在同济建筑馆告别导师顾院长，选择走属于自己的创作道路。
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: '#0284c7' }}>
                        2023年 09月 · 破局
                      </div>
                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          color: '#1e293b',
                          marginTop: '2px',
                        }}
                      >
                        与林见夏成立独立工作室
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: '#64748b',
                          marginTop: '2px',
                          lineHeight: 1.4,
                        }}
                      >
                        离开大型设计院流水线，租下第一间挑高阁楼，开启自主实践。
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: '#0284c7' }}>
                        2025年 03月 · 落地
                      </div>
                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          color: '#1e293b',
                          marginTop: '2px',
                        }}
                      >
                        拿下巨鹿路老洋房改造案
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: '#64748b',
                          marginTop: '2px',
                          lineHeight: 1.4,
                        }}
                      >
                        历经五轮竞标，把水刷石与光庭设计变为现实，奠定业界声誉。
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: '#16a34a' }}>
                        ● 此刻 · 2026年 09月
                      </div>
                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          color: '#1e293b',
                          marginTop: '2px',
                        }}
                      >
                        空间竣工，露台迎来初秋雨水
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: '#64748b',
                          marginTop: '2px',
                          lineHeight: 1.4,
                        }}
                      >
                        沈棠策划的开幕展在即，生活在此刻拥有了从容而真实的呼吸节奏。
                      </div>
                    </div>
                  </div>
                </div>

                {/* 角色人脉网络（严格对齐 Screen 02） */}
                <div>
                  <h4
                    style={{
                      margin: '0 0 10px 0',
                      fontSize: '14px',
                      fontWeight: 600,
                      color: '#1e293b',
                    }}
                  >
                    👥 核心人脉网络（共 {data.actors.length} 位）
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {data.actors.map((actor) => (
                      <div
                        key={actor.id}
                        style={{
                          background: '#ffffff',
                          borderRadius: '12px',
                          padding: '12px 14px',
                          border: '1px solid #e2e8f0',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <Avatar name={actor.name} />
                            <div>
                              <div style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>
                                {actor.name}
                              </div>
                              <span
                                style={{
                                  fontSize: '11px',
                                  background: '#f1f5f9',
                                  color: '#475569',
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                }}
                              >
                                {actor.relationship}
                              </span>
                            </div>
                          </div>
                          <span style={{ fontSize: '11px', color: '#16a34a' }}>● 在线</span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                          {actor.summary ||
                            `在当前世界中与你紧密相连，是你的${actor.relationship}。`}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                          <a
                            href={`#life=${data.id}&app=messages&target=${actor.id}`}
                            style={{
                              flex: 1,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px',
                              padding: '8px',
                              borderRadius: '8px',
                              background: '#ecfdf5',
                              color: '#059669',
                              fontSize: '12px',
                              fontWeight: 500,
                              textDecoration: 'none',
                              border: '1px solid #a7f3d0',
                            }}
                          >
                            💬 发微信
                          </a>
                          <button
                            type="button"
                            onClick={() => setCallingActor(actor)}
                            style={{
                              flex: 1,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px',
                              padding: '8px',
                              borderRadius: '8px',
                              background: '#eff6ff',
                              color: '#2563eb',
                              fontSize: '12px',
                              fontWeight: 500,
                              border: '1px solid #bfdbfe',
                              cursor: 'pointer',
                            }}
                          >
                            📞 电话呼叫
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    marginTop: '8px',
                  }}
                >
                  <a
                    className="button secondary"
                    href="/possibilities"
                    style={{
                      textAlign: 'center',
                      padding: '10px',
                      borderRadius: '10px',
                      background: '#f1f5f9',
                      color: '#334155',
                      textDecoration: 'none',
                      fontSize: '13px',
                      fontWeight: 500,
                    }}
                  >
                    ← 换一条人生分支
                  </a>
                  <a
                    href="/"
                    style={{
                      textAlign: 'center',
                      padding: '8px',
                      color: '#64748b',
                      textDecoration: 'none',
                      fontSize: '12px',
                    }}
                  >
                    返回现实档案
                  </a>
                </div>
              </div>
            );
          }

          if (panel === 'schedule') {
            return (
              <div
                style={{
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                }}
              >
                <div
                  style={{
                    background: '#f8fafc',
                    borderRadius: '16px',
                    padding: '16px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#0284c7',
                      marginBottom: '4px',
                    }}
                  >
                    ⏱️ 人生时间线与节奏
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>
                    {new Date(data.time.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('zh-CN', {
                      timeZone: 'UTC',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      weekday: 'long',
                    })}
                  </div>
                  <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                    世界时钟：{data.time.slice(11, 16)} ·{' '}
                    <span style={{ color: '#16a34a' }}>🟢 现实同步流转中</span>
                  </div>
                </div>

                <div>
                  <h4
                    style={{
                      margin: '0 0 10px 0',
                      fontSize: '14px',
                      fontWeight: 600,
                      color: '#1e293b',
                    }}
                  >
                    🗓️ 近期关键日程与约定（{data.invitations?.length ?? 0} 项）
                  </h4>
                  {data.invitations && data.invitations.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {data.invitations.map((inv) => (
                        <a
                          key={inv.id}
                          href={`#life=${data.id}&app=calendar&target=${inv.id}`}
                          style={{
                            background: '#ffffff',
                            borderRadius: '12px',
                            padding: '12px 14px',
                            border: '1px solid #e2e8f0',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            textDecoration: 'none',
                          }}
                        >
                          <div>
                            <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
                              {inv.title}
                            </div>
                            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                              {inv.at.slice(0, 10)} {inv.at.slice(11, 16)}
                            </div>
                          </div>
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '3px 8px',
                              borderRadius: '6px',
                              background: inv.status === 'confirmed' ? '#ecfdf5' : '#fffbeb',
                              color: inv.status === 'confirmed' ? '#059669' : '#d97706',
                              fontWeight: 500,
                            }}
                          >
                            {inv.status === 'confirmed' ? '已约好 ›' : '待回复 ›'}
                          </span>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: '14px',
                        background: '#f8fafc',
                        borderRadius: '12px',
                        border: '1px solid #e2e8f0',
                        fontSize: '12px',
                        color: '#64748b',
                      }}
                    >
                      暂无固定日程，去日历中可以查看每日月历和空闲节点。
                    </div>
                  )}
                </div>

                <div
                  style={{
                    background: '#ffffff',
                    borderRadius: '12px',
                    padding: '14px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#0f172a',
                      marginBottom: '4px',
                    }}
                  >
                    🚩 当前剧情篇章
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', lineHeight: 1.6 }}>
                    第一幕 ·
                    做出选择后的第一个清晨。你已收到身边人的来信与碰头邀约。建议在微信与日历中深入探索，逐渐推动关系演化。
                  </div>
                </div>
              </div>
            );
          }

          if (panel === 'director') {
            /* 真实控制：时间（暂停/倍速/推进）与导演要求（主题/节奏/聚焦 + 先看影响）。 */
            return <DirectorPanel client={client} worldId={data.id} />;
          }

          if (panel === 'management') {
            return (
              <div
                style={{
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                  background: '#f8fafc',
                  minHeight: '100%',
                  boxSizing: 'border-box',
                }}
              >
                {/* 1. 顶部 Apple ID / 设备身份卡片 */}
                <div
                  style={{
                    background: '#ffffff',
                    borderRadius: '16px',
                    padding: '16px',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                  }}
                >
                  <div
                    style={{
                      width: '52px',
                      height: '52px',
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #0284c7, #0369a1)',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '20px',
                      fontWeight: 700,
                    }}
                  >
                    我
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                      {data.title}
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                      Parallel Phone 16 Pro · ParallelOS 16.4.2
                    </div>
                  </div>
                </div>

                {/* 2. 手机壁纸个性化选择 */}
                <div
                  style={{
                    background: '#ffffff',
                    borderRadius: '14px',
                    padding: '14px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#0f172a',
                      marginBottom: '8px',
                    }}
                  >
                    🖼️ 手机壁纸选择
                  </div>
                  <div
                    style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}
                  >
                    {[
                      { name: '经典窗景', url: '/art/first-window.webp' },
                      {
                        name: '极夜星空',
                        url: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1080&q=80',
                      },
                      {
                        name: '秋日山野',
                        url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1080&q=80',
                      },
                      {
                        name: '暗曜极简',
                        url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1080&q=80',
                      },
                    ].map((w) => (
                      <button
                        key={w.name}
                        type="button"
                        onClick={() => {
                          playTapSound();
                          changeWallpaper(w.url);
                        }}
                        style={{
                          border:
                            wallpaperUrl === w.url ? '2px solid #0284c7' : '1px solid #e2e8f0',
                          borderRadius: '10px',
                          overflow: 'hidden',
                          background: '#f1f5f9',
                          padding: 0,
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                        }}
                      >
                        <img
                          src={w.url}
                          alt={w.name}
                          style={{ width: '100%', height: '54px', objectFit: 'cover' }}
                        />
                        <span style={{ fontSize: '10px', padding: '4px 2px', color: '#475569' }}>
                          {w.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3. 系统存储与网络 */}
                <div
                  style={{
                    background: '#ffffff',
                    borderRadius: '14px',
                    padding: '12px 14px',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}
                  >
                    <span style={{ color: '#475569' }}>📱 存储空间</span>
                    <span style={{ fontWeight: 600, color: '#0f172a' }}>已用 18.2 MB / 256 GB</span>
                  </div>
                  <div
                    style={{
                      height: '6px',
                      borderRadius: '3px',
                      background: '#e2e8f0',
                      overflow: 'hidden',
                    }}
                  >
                    <div style={{ width: '8%', height: '100%', background: '#0284c7' }} />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '13px',
                      borderTop: '1px solid #f1f5f9',
                      paddingTop: '8px',
                    }}
                  >
                    <span style={{ color: '#475569' }}>📶 蜂窝网络</span>
                    <span style={{ fontWeight: 600, color: '#16a34a' }}>5G 全网通 (已连接)</span>
                  </div>
                </div>

                {/* 4. 平行人生导航 */}
                <div
                  style={{
                    background: '#ffffff',
                    borderRadius: '14px',
                    padding: '6px 0',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  {[
                    {
                      label: '与导演讨论剧情',
                      action: () => {
                        window.location.hash = routeHash(data.id, { app: null, panel: 'director' });
                      },
                      icon: '🎬',
                    },
                    {
                      label: '当前身份与人脉档案',
                      action: () => {
                        window.location.hash = routeHash(data.id, { app: null, panel: 'timeline' });
                      },
                      icon: '👥',
                    },
                    {
                      label: '故事时间与安排',
                      action: () => {
                        window.location.hash = routeHash(data.id, { app: null, panel: 'schedule' });
                      },
                      icon: '⏱️',
                    },
                    { label: '返回现实档案', action: () => (location.href = '/'), icon: '🏡' },
                    {
                      label: '切换到其他人生分支',
                      action: () => (location.href = '/possibilities'),
                      icon: '🔀',
                    },
                  ].map((item, idx) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={item.action}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        padding: '12px 14px',
                        background: 'none',
                        border: 'none',
                        borderBottom: idx < 4 ? '1px solid #f1f5f9' : 'none',
                        fontSize: '13.5px',
                        color: '#0f172a',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <span>
                        <span style={{ marginRight: '8px' }}>{item.icon}</span>
                        {item.label}
                      </span>
                      <span style={{ color: '#94a3b8' }}>›</span>
                    </button>
                  ))}
                </div>

                {/* 5. 隐私与数据安全 (AUD-20) */}
                <div
                  style={{
                    background: '#ffffff',
                    borderRadius: '14px',
                    padding: '14px',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
                    🛡️ 隐私与数据管理 (GDPR)
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const blob = await client.exportData();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `parallel-life-export-${data.id.slice(0, 8)}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                        alert('已成功导出你的全部个人档案与剧本数据！');
                      } catch {
                        alert('导出失败，请重试');
                      }
                    }}
                    style={{
                      padding: '10px',
                      borderRadius: '10px',
                      background: '#f1f5f9',
                      border: '1px solid #cbd5e1',
                      color: '#0f172a',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    💾 导出全部档案与人生剧本 (JSON)
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (
                        confirm(
                          '确定要清除这台手机的登录会话吗？你的服务端数据不会丢失，刷新后可重新开启。',
                        )
                      ) {
                        await client.clearSession();
                        location.href = '/';
                      }
                    }}
                    style={{
                      padding: '10px',
                      borderRadius: '10px',
                      background: '#fef2f2',
                      border: '1px solid #fecaca',
                      color: '#dc2626',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    🗑️ 注销登录会话 / 重置这台手机
                  </button>
                </div>
              </div>
            );
          }

          return null;
        }}
      />
      {callingActor && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.92)',
            backdropFilter: 'blur(20px)',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '64px 24px 48px',
            color: '#ffffff',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: '88px',
                height: '88px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #059669, #0d9488)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '34px',
                fontWeight: 700,
                boxShadow: '0 8px 24px rgba(5,150,105,0.4)',
                marginBottom: '16px',
              }}
            >
              {callingActor.name.slice(0, 1)}
            </div>
            <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700 }}>{callingActor.name}</h2>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '6px' }}>
              {callingActor.relationship} · 正在呼叫...
            </div>
            <div
              style={{
                fontSize: '12px',
                color: '#6ee7b7',
                marginTop: '20px',
                background: 'rgba(5,150,105,0.25)',
                padding: '8px 16px',
                borderRadius: '20px',
                border: '1px solid rgba(110,231,183,0.3)',
                lineHeight: 1.5,
              }}
            >
              🎙️ 对方正在老洋房现场布展，建议发送微信沟通
            </div>
          </div>

          <div
            style={{
              width: '100%',
              maxWidth: '320px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <a
              href={`#life=${data.id}&app=messages&target=${callingActor.id}`}
              onClick={() => setCallingActor(null)}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '14px',
                background: '#10b981',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: '15px',
                textAlign: 'center',
                textDecoration: 'none',
                boxShadow: '0 4px 14px rgba(16,185,129,0.35)',
                boxSizing: 'border-box',
              }}
            >
              💬 转为微信留言
            </a>
            <button
              type="button"
              onClick={() => setCallingActor(null)}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '14px',
                background: 'rgba(239, 68, 68, 0.2)',
                color: '#f87171',
                border: '1px solid rgba(239,68,68,0.4)',
                fontWeight: 600,
                fontSize: '15px',
                cursor: 'pointer',
              }}
            >
              ✕ 挂断
            </button>
          </div>
        </div>
      )}
    </PhoneAppsProvider>
  );
}
