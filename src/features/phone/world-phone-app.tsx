'use client';
import { useEffect, useState } from 'react';
import { AppViewport } from '../../components/app-viewport.tsx';
import { LifeClient, ApiFailure } from '../api/client.ts';
import { Button, Notice } from '../../components/ui.tsx';
import type { WorldPhone } from '../../contracts/world-build.ts';
import { PhoneShell, type PhoneAppContext } from './phone-shell.tsx';
export function WorldPhoneApp({ worldId }: { worldId: string }) {
  const [client] = useState(() => new LifeClient()),
    [data, setData] = useState<WorldPhone | null>(null),
    [error, setError] = useState('');
  async function load() {
    setError('');
    try {
      setData(await client.world(worldId));
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : '暂时无法打开这段人生。');
    }
  }
  useEffect(() => {
    void load();
  }, [worldId]);
  return (
    <div className="world-viewport">
      <AppViewport />
      {!data ? (
        <div className="world-loading">
          <a href="/possibilities">← 返回如果</a>
          {error ? (
            <>
              <Notice>{error}</Notice>
              <Button onClick={() => void load()}>重新打开</Button>
            </>
          ) : (
            <p>正在打开你的手机…</p>
          )}
        </div>
      ) : (
        <WorldPhoneSurface data={data} />
      )}
    </div>
  );
}

export function WorldPhoneSurface({
  data,
  preview = false,
}: {
  data: WorldPhone;
  preview?: boolean;
}) {
  function app({ app, target, open }: PhoneAppContext) {
    if (app === 'messages') {
      const actor = data.actors.find((a) => a.id === target);
      return actor ? (
        <div className="world-thread">
          <h3>{actor.name}</h3>
          <p>{actor.relationship}</p>
          {data.messages
            .filter((m) => m.actorId === actor.id)
            .map((m) => (
              <p className="world-message" key={m.id}>
                {m.text}
              </p>
            ))}
          {!data.messages.some((m) => m.actorId === actor.id) && <p>你们还没有新消息。</p>}
          <Notice tone="info">开场已保存，持续角色对话即将接入。</Notice>
        </div>
      ) : (
        <div className="world-contacts">
          {data.actors.map((a) => (
            <button key={a.id} onClick={() => open('messages', a.id)}>
              <span className="world-avatar">{a.name.slice(0, 1)}</span>
              <span>
                <strong>{a.name}</strong>
                <small>
                  {data.messages.filter((m) => m.actorId === a.id).at(-1)?.text ?? a.relationship}
                </small>
              </span>
              <span>›</span>
            </button>
          ))}
        </div>
      );
    }
    if (app === 'notes')
      return (
        <div className="world-notes">
          {data.notes.map((n, i) => (
            <article key={i}>
              <h3>{n.title}</h3>
              <p>{n.text}</p>
            </article>
          ))}
        </div>
      );
    return (
      <div className="world-empty">
        <h3>
          {app === 'photos'
            ? '还没有生成照片'
            : app === 'calendar'
              ? '还没有确认的约定'
              : '这里还没有动态'}
        </h3>
        <p>
          {app === 'photos'
            ? '世界照片生成后会出现在这里。当前壁纸是通用素材。'
            : '开场中的邀请不会自动变成你已接受的安排。'}
        </p>
      </div>
    );
  }
  return (
    <PhoneShell
      worldId={data.id}
      lifeName={data.title}
      dateLabel={new Date(data.time).toLocaleDateString('zh-CN', {
        month: 'long',
        day: 'numeric',
        weekday: 'long',
      })}
      timeLabel={new Date(data.time).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })}
      wallpaperUrl="/art/first-window.webp"
      notice={
        <span>
          {preview ? '开发样板 · 合成数据 · 未调用模型' : '虚构世界 · 通用壁纸 · 开场时间'}
        </span>
      }
      notifications={data.messages.slice(0, 2).map((m) => ({
        id: m.id,
        title: data.actors.find((a) => a.id === m.actorId)?.name ?? '新消息',
        summary: m.text,
        app: 'messages',
        target: m.actorId,
      }))}
      renderApp={app}
      renderPanel={(panel) =>
        panel === 'timeline' ? (
          <div className="world-notes">
            <h3>这个世界里的你</h3>
            <p>{data.identity}</p>
            <p>{data.setting}</p>
            <a className="button secondary" href="/possibilities">
              返回如果，选择其他人生
            </a>
          </div>
        ) : panel === 'schedule' ? (
          <p>故事停留在开场，时间推进与暂停控制尚未接入。</p>
        ) : panel === 'director' ? (
          <p>导演调整尚未开放，你可以先查看这段人生的身份与开场。</p>
        ) : null
      }
    />
  );
}
