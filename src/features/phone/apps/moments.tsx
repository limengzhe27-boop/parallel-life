'use client';
import { LifeClient } from '../../api/client.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  const { worldId, transport, data, actions } = usePhoneApps();
  const canWrite = Boolean(actions.sendMessage);
  const client = useMemo(() => new LifeClient(transport), [transport]);
  const [draft, setDraft] = useState('');
  const [composing, setComposing] = useState(false);
  const [audience, setAudience] = useState<string[] | undefined>();
  const [saving, setSaving] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const lastPublish = useRef<{ payload: string; commandId: string } | undefined>(undefined);
  async function publish() {
    const text = draft.trim();
    if (!text || saving) return;
    const payload = JSON.stringify([worldId, text, audience]);
    const commandId =
      lastPublish.current?.payload === payload
        ? lastPublish.current.commandId
        : crypto.randomUUID();
    lastPublish.current = { payload, commandId };
    setSaving('publish');
    setWriteError(null);
    try {
      await client.updatePlayerSocial(worldId, {
        commandId,
        kind: 'publish',
        text,
        audienceActorIds: audience,
      });
      lastPublish.current = undefined;
      setDraft('');
      setAudience(undefined);
      setComposing(false);
      setReload((r) => r + 1);
    } catch {
      setWriteError('动态暂未确认发布，草稿已保留。');
    } finally {
      setSaving(null);
    }
  }
  async function like(momentKey: string) {
    if (saving) return;
    setSaving(momentKey);
    setWriteError(null);
    try {
      await client.updatePlayerSocial(worldId, {
        commandId: crypto.randomUUID(),
        kind: 'like',
        momentKey,
      });
      setReload((r) => r + 1);
    } catch {
      setWriteError('暂时没能点赞，可以重试。');
    } finally {
      setSaving(null);
    }
  }
  const [loaded, setResult] = useState<{ worldId: string; social: AuthoredSocial } | null>(null),
    [error, setError] = useState(false),
    [reload, setReload] = useState(0);
  const reference = Date.parse(data.referenceTime ?? '');
  const storyMinute = Number.isFinite(reference) ? Math.floor(reference / 60000) : null;
  const latestMessage = data.messages.at(-1)?.id;
  useEffect(() => {
    const controller = new AbortController();
    if (loaded?.worldId !== worldId) {
      setResult(null);
    }
    setError(false);
    const run = async () => {
      try {
        const response = await (transport ?? fetch)(
          `/api/v1/worlds/${encodeURIComponent(worldId)}/social`,
          { signal: controller.signal },
        );
        if (!response.ok) throw Error();
        const parsed = AuthoredSocialSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setError(false);
          setResult({ worldId, social: parsed });
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    };
    void run();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    const timer =
      typeof document !== 'undefined' ? setInterval(() => void run(), 30000) : undefined;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      if (timer !== undefined) clearInterval(timer);
      if (typeof document !== 'undefined')
        document.removeEventListener('visibilitychange', onVisible);
    };
  }, [worldId, transport, reload, storyMinute, latestMessage]);
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
        {!target && canWrite && (
          <button type="button" onClick={() => setComposing((value) => !value)}>
            {composing ? '收起' : '发动态'}
          </button>
        )}
      </header>
      {!target && composing && canWrite && (
        <form
          className={feed.composer}
          onSubmit={(event) => {
            event.preventDefault();
            void publish();
          }}
        >
          <label htmlFor="moment-draft">分享这一刻</label>
          <textarea
            id="moment-draft"
            value={draft}
            maxLength={1600}
            disabled={saving !== null}
            onChange={(event) => setDraft(event.target.value)}
          />
          <label>
            谁可以看
            <select
              value={audience === undefined ? 'all' : 'selected'}
              disabled={saving !== null}
              onChange={(event) => setAudience(event.target.value === 'all' ? undefined : [])}
            >
              <option value="all">所有人物</option>
              <option value="selected">指定人物</option>
            </select>
          </label>
          {audience !== undefined && (
            <fieldset disabled={saving !== null}>
              <legend>可见人物（留空为仅自己可见）</legend>
              {data.contacts.map((contact) => (
                <label key={contact.id}>
                  <input
                    type="checkbox"
                    checked={audience.includes(contact.id)}
                    onChange={(event) =>
                      setAudience(
                        event.target.checked
                          ? [...audience, contact.id]
                          : audience.filter((id) => id !== contact.id),
                      )
                    }
                  />
                  {contact.name}
                </label>
              ))}
            </fieldset>
          )}
          <button type="submit" disabled={!draft.trim() || saving !== null}>
            {saving === 'publish' ? '发布中…' : '发布'}
          </button>
        </form>
      )}
      {writeError && (
        <p role="alert" className={feed.feedback}>
          {writeError}
        </p>
      )}
      {person && (
        <section className={feed.profile} aria-label="人物朋友圈">
          <Avatar url={person.avatarUrl} name={person.name} />
          <strong>{person.name}</strong>
        </section>
      )}
      {target &&
        result?.profiles?.some(
          (profile) => profile.actorId === target && profile.momentsVisibility === 'three_days',
        ) && <p className={feed.feedback}>朋友仅展示最近三天的朋友圈</p>}
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
                {m.actorId === 'player' ? (
                  <span className={feed.selfAvatar}>我</span>
                ) : (
                  <button
                    type="button"
                    className={feed.avatar}
                    onClick={() => open('messages', m.actorId)}
                    aria-label={`和${m.name}聊天`}
                  >
                    {contact?.avatarUrl ? (
                      <img src={contact.avatarUrl} alt="" />
                    ) : (
                      m.name.slice(0, 1)
                    )}
                  </button>
                )}
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
                  {canWrite && m.actorId !== 'player' && (
                    <button
                      type="button"
                      className={feed.likeButton}
                      disabled={
                        saving !== null || m.likes?.some((entry) => entry.actorId === 'player')
                      }
                      onClick={() => void like(m.key)}
                    >
                      {m.likes?.some((entry) => entry.actorId === 'player') ? '♥ 已赞' : '♡ 点赞'}
                    </button>
                  )}
                  {((m.likes && m.likes.length > 0) || (m.comments && m.comments.length > 0)) && (
                    <div className={feed.interactions}>
                      {m.likes && m.likes.length > 0 && (
                        <div className={feed.likes} aria-label="点赞列表">
                          <span className={feed.likeIcon} aria-hidden="true">
                            ♥
                          </span>
                          <span className={feed.likeNames}>
                            {m.likes.map((like) => like.name).join('、')}
                          </span>
                        </div>
                      )}
                      {m.comments && m.comments.length > 0 && (
                        <ul className={feed.comments} aria-label="评论列表">
                          {m.comments.map((comment) => (
                            <li key={comment.id} className={feed.commentItem}>
                              <strong className={feed.commentAuthor}>{comment.name}</strong>:{' '}
                              {comment.text}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
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
