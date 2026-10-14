'use client';
import { useEffect, useState } from 'react';
import type { PhoneAppContext } from '../phone-shell.tsx';
import { AuthoredSocialSchema, type AuthoredSocial } from '../../../contracts/authored-social.ts';
import { usePhoneApps } from './provider.tsx';
import { Avatar, Empty } from './common.tsx';
import s from './apps.module.css';
import feed from './moments.module.css';
import { MomentGallery } from '../../media/moment-gallery.tsx';
import { momentImages } from '../../../modules/settings/domain/moment-visibility.ts';
/** Authored opening posts are saved content, not fabricated real-time reactions. */
export function MomentsApp({ open, target }: PhoneAppContext) {
  const { worldId, transport, data } = usePhoneApps();
  const [loaded, setResult] = useState<{ worldId: string; social: AuthoredSocial } | null>(null),
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
        if (!controller.signal.aborted) setResult({ worldId, social: parsed });
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    };
    void run();
    return () => controller.abort();
  }, [worldId, transport, reload]);
  const result = loaded?.worldId === worldId ? loaded.social : null;
  const moments = result?.moments.filter((m) => !target || m.actorId === target) ?? [];
  const person = target ? data.contacts.find((contact) => contact.id === target) : undefined;
  const name = person?.name ?? moments[0]?.name;
  return (
    <div className={s.app}>
      <header className={`${s.sectionHeading} ${feed.heading}`}>
        <button
          type="button"
          onClick={() => open('messages', target)}
          aria-label={target ? `返回${name ?? '这个联系人'}的聊天` : '返回消息'}
        >
          ‹
        </button>
        <h2>{target ? `${name ?? 'TA'}的朋友圈` : '朋友圈'}</h2>
      </header>
      {person && (
        <section className={feed.profile} aria-label="人物朋友圈">
          <Avatar url={person.avatarUrl} name={person.name} />
          <strong>{person.name}</strong>
        </section>
      )}
      {error ? (
        <div role="alert" className={feed.feedback}>
          动态暂时没能读取。<button onClick={() => setReload((r) => r + 1)}>重试</button>
        </div>
      ) : !result ? (
        <p role="status" className={feed.feedback}>
          正在读取动态…
        </p>
      ) : moments.length ? (
        <section aria-label={target ? `${name ?? 'TA'}的动态` : '朋友的动态'} className={feed.list}>
          {moments.map((m) => {
            const contact = data.contacts.find((c) => c.id === m.actorId);
            return (
              <article key={m.key} className={feed.post}>
                <button
                  type="button"
                  className={feed.avatar}
                  onClick={() => open('messages', m.actorId)}
                  aria-label={`和${m.name}聊天`}
                >
                  {contact?.avatarUrl ? <img src={contact.avatarUrl} alt="" /> : m.name.slice(0, 1)}
                </button>
                <div>
                  <strong>{m.name}</strong>
                  <p>{m.text}</p>
                  <MomentGallery images={momentImages(m)} label={`${m.name}的朋友圈`} />
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
        <Empty
          title={target ? `${name ?? 'TA'}还没有动态` : '还没有动态'}
          text={target ? '这里显示已保存的朋友圈内容。' : '朋友分享的生活会留在这里。'}
        />
      )}
    </div>
  );
}
