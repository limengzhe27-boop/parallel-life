'use client';
import { useEffect, useState } from 'react';
import type { PhoneAppContext } from '../phone-shell.tsx';
import { AuthoredSocialSchema, type AuthoredSocial } from '../../../contracts/authored-social.ts';
import { usePhoneApps } from './provider.tsx';
import { Empty } from './common.tsx';
import s from './apps.module.css';
import feed from './moments.module.css';
/** Authored opening posts are saved content, not fabricated real-time reactions. */
export function MomentsApp({ open, target }: PhoneAppContext) {
  const { worldId, transport, data } = usePhoneApps();
  const [result, setResult] = useState<AuthoredSocial | null>(null),
    [error, setError] = useState(false),
    [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setError(false);
    const run = async () => {
      try {
        const response = await (transport ?? fetch)(
          `/api/v1/worlds/${encodeURIComponent(worldId)}/social`,
          { signal: controller.signal },
        );
        if (!response.ok) throw Error();
        const parsed = AuthoredSocialSchema.parse(await response.json());
        if (!controller.signal.aborted) setResult(parsed);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    };
    void run();
    return () => controller.abort();
  }, [worldId, transport, reload]);
  const moments = result?.moments.filter((m) => !target || m.actorId === target) ?? [];
  return (
    <div className={s.app}>
      <header className={s.sectionHeading}>
        <button type="button" onClick={() => open('messages')} aria-label="返回消息">
          ‹
        </button>
        <h2>朋友圈</h2>
      </header>
      {error ? (
        <div role="alert" className={feed.feedback}>
          动态暂时没能读取。<button onClick={() => setReload((r) => r + 1)}>重试</button>
        </div>
      ) : !result ? (
        <p role="status" className={feed.feedback}>
          正在读取动态…
        </p>
      ) : moments.length ? (
        <section aria-label="朋友的动态" className={feed.list}>
          {moments.map((m) => {
            const contact = data.contacts.find((c) => c.id === m.actorId);
            return (
              <article key={m.key} className={feed.post}>
                <button
                  className={feed.avatar}
                  onClick={() => open('messages', m.actorId)}
                  aria-label={`和${m.name}聊天`}
                >
                  {contact?.avatarUrl ? <img src={contact.avatarUrl} alt="" /> : m.name.slice(0, 1)}
                </button>
                <div>
                  <strong>{m.name}</strong>
                  <p>{m.text}</p>
                  <time dateTime={m.at}>
                    {new Date(m.at).toLocaleString('zh-CN', {
                      timeZone: 'Asia/Shanghai',
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}
                  </time>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <Empty title="还没有动态" text="朋友分享的生活会留在这里。" />
      )}
    </div>
  );
}
