'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppViewport } from '../../components/app-viewport.tsx';
import { LifeClient, ApiFailure } from '../api/client.ts';
import { Button, Notice } from '../../components/ui.tsx';
import type { WorldPhone } from '../../contracts/world-build.ts';
import { PhoneShell } from './phone-shell.tsx';
import { PhoneAppsProvider, PhoneAppView } from './apps/index.tsx';
import type { PhoneActions } from './apps/types.ts';
import { worldAppData } from './world-app-data.ts';
export function WorldPhoneApp({ worldId }: { worldId: string }) {
  const [client] = useState(() => new LifeClient()),
    [data, setData] = useState<WorldPhone | null>(null),
    [error, setError] = useState(''),
    [isBuilding, setIsBuilding] = useState(false),
    [statusMessage, setStatusMessage] = useState('正在打开你的手机…'),
    [refreshing, setRefreshing] = useState(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    const currentRequest = ++request.current;
    setRefreshing(true);
    setError('');
    setIsBuilding(false);
    setStatusMessage('正在打开你的手机…');
    try {
      const incoming = await client.world(worldId);
      if (currentRequest === request.current) {
        setData(incoming);
        return;
      }
    } catch (e) {
      // 检查世界是否在构建中或任务中断，自动自愈与接续构建
      try {
        const builds = await client.builds();
        const targetBuild = builds.find((b) => b.worldId === worldId);
        if (targetBuild) {
          if (!targetBuild.ready && targetBuild.task) {
            if (currentRequest === request.current) {
              setIsBuilding(true);
              setStatusMessage('🎬 正在为你雕刻平行世界身份、微信消息与开场画面…');
            }
            let currentTaskId = targetBuild.task.id;
            if (targetBuild.task.status === 'failed' || targetBuild.task.status === 'unknown') {
              if (currentRequest === request.current) {
                setStatusMessage('正在重新准备开机…');
              }
              const retried = await client.retryTask(targetBuild.task.id, crypto.randomUUID());
              currentTaskId = retried.id;
            }
            await client.task(currentTaskId);
            const incoming = await client.world(worldId);
            if (currentRequest === request.current) {
              setData(incoming);
              setIsBuilding(false);
              return;
            }
          }
        }
      } catch (buildError) {
        console.warn('Auto build resolution failed:', buildError);
      }

      if (currentRequest === request.current) {
        setIsBuilding(false);
        setError(e instanceof ApiFailure ? e.message : '暂时无法打开这段人生。');
      }
    } finally {
      if (currentRequest === request.current) setRefreshing(false);
    }
  }, [client, worldId]);
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
            <div style={{ textAlign: 'center', padding: '24px 16px' }}>
              <div
                className="build-state-spinner"
                style={{
                  margin: '0 auto 16px',
                  width: 32,
                  height: 32,
                  border: '3px solid rgba(255,255,255,0.2)',
                  borderTopColor: '#d4af37',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }}
              />
              <p style={{ fontWeight: 600, color: '#f5d580', marginBottom: '8px' }}>
                {statusMessage}
              </p>
              <small style={{ color: '#888' }}>大模型正在推演中，马上为你开机…</small>
            </div>
          ) : error ? (
            <>
              <Notice>{error}</Notice>
              <Button onClick={() => void load()}>重新打开</Button>
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
            const receipt = await client.sendWorldMessage(worldId, {
              commandId,
              actorId,
              text,
              expectedVersion: data.version ?? 0,
            });
            await load();
            return { status: receipt.status };
          }}
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
  onUploadPhoto,
  loading = false,
  loadError,
}: {
  data: WorldPhone;
  preview?: boolean;
  onReload?: () => Promise<void>;
  onChangeInvitation?: PhoneActions['changeInvitation'];
  onSendMessage?: PhoneActions['sendMessage'];
  onUploadPhoto?: PhoneActions['uploadPhoto'];
  loading?: boolean;
  loadError?: string;
}) {
  const [viewed, setViewed] = useState<ReadonlySet<string>>(new Set());
  const phoneData = worldAppData(data, viewed);
  return (
    <PhoneAppsProvider
      worldId={data.id}
      data={phoneData}
      loading={loading}
      loadError={loadError}
      onReload={onReload}
      actions={{
        changeInvitation: preview ? undefined : onChangeInvitation,
        sendMessage: preview ? undefined : onSendMessage,
        uploadPhoto: preview ? undefined : onUploadPhoto,
        markRead: async (actorId) => {
          setViewed(
            (current) =>
              new Set([
                ...current,
                ...data.messages.filter((m) => m.actorId === actorId).map((m) => m.id),
              ]),
          );
        },
      }}
    >
      <PhoneShell
        worldId={data.id}
        lifeName={data.title}
        dateLabel={new Date(data.time.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('zh-CN', {
          timeZone: 'UTC',
          month: 'long',
          day: 'numeric',
          weekday: 'long',
        })}
        timeLabel={data.time.slice(11, 16)}
        wallpaperUrl="/art/first-window.webp"
        // Product worlds stay immersive. Only the explicit development preview
        // exposes its synthetic-data label; production lock screens contain
        // only the time, wallpaper and real notifications.
        notice={preview ? <span>开发样板 · 合成数据 · 未调用模型</span> : undefined}
        notifications={data.messages
          .filter((m) => m.role !== 'user')
          .slice(-2)
          .map((m) => ({
            id: m.id,
            title: data.actors.find((a) => a.id === m.actorId)?.name ?? '新消息',
            summary: m.text,
            app: 'messages',
            target: m.actorId,
          }))}
        renderApp={(context) => <PhoneAppView {...context} />}
        renderPanel={(panel) =>
          panel === 'timeline' ? (
            <div className="world-notes">
              <h3>这个世界里的你</h3>
              <p>{data.identity}</p>
              <p>{data.setting}</p>
              <a className="button secondary" href="/possibilities">
                返回分支，选择其他人生
              </a>
            </div>
          ) : panel === 'schedule' ? (
            <p>故事停留在开场，时间推进与暂停控制尚未接入。</p>
          ) : panel === 'director' ? (
            <p>导演调整尚未开放，你可以先查看这段人生的身份与开场。</p>
          ) : null
        }
      />
    </PhoneAppsProvider>
  );
}
