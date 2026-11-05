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
  const [panel, setPanel] = useState<'camera' | 'photos' | 'audience' | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [uploaded, setUploaded] = useState<{ id: string; url: string; title: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [commentKey, setCommentKey] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const commentRequest = useRef<{ payload: string; id: string } | undefined>(undefined);
  const uploadRequests = useRef(new WeakMap<File, string>());
  const photoOptions = [
    ...uploaded,
    ...data.photos
      .filter((photo) => photo.status === 'ready' && photo.url && photo.mediaType !== 'video')
      .map((photo) => ({ id: photo.id, url: photo.url!, title: photo.title })),
  ].filter((photo, index, all) => all.findIndex((item) => item.id === photo.id) === index);
  async function upload(files: FileList | null) {
    if (!files?.length || uploading || saving) return;
    if (files.length + images.length > 9) {
      setWriteError('最多选择9张照片。');
      return;
    }
    setUploading(true);
    setWriteError(null);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) throw Error('请选择图片文件。');
        const commandId = uploadRequests.current.get(file) ?? crypto.randomUUID();
        uploadRequests.current.set(file, commandId);
        const photo = await client.uploadPhoto(worldId, file, commandId);
        const url = `/api/v1/assets/${encodeURIComponent(photo.id)}?worldId=${encodeURIComponent(worldId)}&revision=${photo.revision}`;
        setUploaded((old) =>
          old.some((item) => item.id === photo.id)
            ? old
            : [...old, { id: photo.id, url, title: photo.title }],
        );
        setImages((old) => (old.includes(url) ? old : [...old, url]));
      }
    } catch {
      setWriteError('有照片未能上传。已上传的照片已保留，请重新选择失败的照片。');
    } finally {
      setUploading(false);
    }
  }
  async function sendComment() {
    if (!commentKey || !comment.trim() || saving) return;
    const payload = JSON.stringify([worldId, commentKey, comment.trim()]);
    const commandId =
      commentRequest.current?.payload === payload ? commentRequest.current.id : crypto.randomUUID();
    commentRequest.current = { payload, id: commandId };
    setSaving(commentKey);
    setWriteError(null);
    try {
      await client.updatePlayerSocial(worldId, {
        kind: 'comment',
        commandId,
        momentKey: commentKey,
        comment: comment.trim(),
      });
      setComment('');
      setCommentKey(null);
      commentRequest.current = undefined;
      setReload((value) => value + 1);
    } catch {
      setWriteError('评论暂未确认发送，内容已保留，请重试。');
    } finally {
      setSaving(null);
    }
  }
  const [audience, setAudience] = useState<string[] | undefined>();
  const [choosingPeople, setChoosingPeople] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const lastPublish = useRef<{ payload: string; commandId: string } | undefined>(undefined);
  async function publish() {
    const text = draft.trim();
    if ((!text && !images.length) || saving || uploading) return;
    const payload = JSON.stringify([worldId, text, audience, images]);
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
        images,
        audienceActorIds: audience,
      });
      lastPublish.current = undefined;
      setDraft('');
      setImages([]);
      setAudience(undefined);
      setChoosingPeople(false);
      setComposing(false);
      setReload((r) => r + 1);
    } catch {
      setWriteError('动态暂未确认发布，草稿已保留。');
    } finally {
      setSaving(null);
    }
  }
  async function like(momentKey: string, liked = false) {
    if (saving) return;
    setSaving(momentKey);
    setWriteError(null);
    try {
      await client.updatePlayerSocial(worldId, {
        commandId: crypto.randomUUID(),
        kind: liked ? 'unlike' : 'like',
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
  const audienceLabel = audience === undefined ? '公开' : audience.length ? '部分可见' : '私密';
  if (composing && canWrite)
    return (
      <div className={`${s.app} ${feed.editor}`}>
        <header className={feed.editorHeader}>
          <button
            type="button"
            disabled={saving !== null || uploading}
            onClick={() => {
              setComposing(false);
              setPanel(null);
            }}
          >
            取消
          </button>
          <strong>发表朋友圈</strong>
          <button
            type="button"
            className={feed.publish}
            disabled={saving !== null || uploading || (!draft.trim() && !images.length)}
            onClick={() => void publish()}
          >
            {saving === 'publish' ? '发表中…' : '发表'}
          </button>
        </header>
        <div className={feed.editorBody}>
          <textarea
            aria-label="这一刻的想法"
            placeholder="这一刻的想法…"
            maxLength={1600}
            disabled={saving !== null}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div style={{ maxWidth: Math.min(3, images.length) * 100 }}>
            <MomentGallery images={images} label="待发表的照片" />
          </div>
          {images.length > 0 && (
            <div className={feed.removePhotos}>
              {images.map((url, index) => (
                <button
                  key={url}
                  type="button"
                  disabled={saving !== null || uploading}
                  onClick={() => setImages((old) => old.filter((item) => item !== url))}
                >
                  移除第{index + 1}张
                </button>
              ))}
            </div>
          )}
          {images.length < 9 && (
            <button
              type="button"
              className={feed.addPhoto}
              aria-label="添加照片"
              disabled={uploading || saving !== null}
              onClick={() => setPanel('photos')}
            >
              ＋
            </button>
          )}
          <button
            type="button"
            className={feed.settingRow}
            disabled={saving !== null}
            onClick={() => setPanel('audience')}
          >
            <span>谁可以看</span>
            <span>{audienceLabel} ›</span>
          </button>
          {writeError && (
            <p role="alert" className={feed.feedback}>
              {writeError}
            </p>
          )}
          {uploading && <p role="status">照片上传中…</p>}
        </div>
        {panel === 'audience' && (
          <section className={feed.subpage} aria-label="谁可以看">
            <header className={feed.editorHeader}>
              <button onClick={() => setPanel(null)}>返回</button>
              <strong>谁可以看</strong>
              <button onClick={() => setPanel(null)}>完成</button>
            </header>
            {(['公开', '私密', '部分可见'] as const).map((label) => (
              <label className={feed.settingRow} key={label}>
                <span>
                  {label}
                  <small>
                    {label === '公开'
                      ? '所有人物可见'
                      : label === '私密'
                        ? '仅自己可见'
                        : '选中的人物可见'}
                  </small>
                </span>
                <input
                  type="radio"
                  name="moment-visibility"
                  checked={label === (choosingPeople ? '部分可见' : audienceLabel)}
                  onChange={() => {
                    setChoosingPeople(label === '部分可见');
                    setAudience(
                      label === '公开' ? undefined : label === '私密' ? [] : (audience ?? []),
                    );
                  }}
                />
              </label>
            ))}
            {choosingPeople &&
              audience !== undefined &&
              data.contacts.map((contact) => (
                <label key={contact.id} className={feed.settingRow}>
                  <span>{contact.name}</span>
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
                </label>
              ))}
          </section>
        )}
        {panel === 'photos' && (
          <section className={feed.subpage} aria-label="选择照片">
            <header className={feed.editorHeader}>
              <button disabled={uploading} onClick={() => setPanel(null)}>
                返回
              </button>
              <strong>照片（{images.length}/9）</strong>
              <button disabled={uploading} onClick={() => setPanel(null)}>
                完成
              </button>
            </header>
            <label className={feed.uploadButton}>
              从设备上传
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={uploading || images.length >= 9}
                onChange={(event) => void upload(event.target.files)}
              />
            </label>
            {writeError && <p role="alert">{writeError}</p>}
            {uploading && <p role="status">照片上传中…</p>}
            <div className={feed.photoPicker}>
              {photoOptions.map((photo) => (
                <button
                  type="button"
                  key={photo.id}
                  aria-label={`选择${photo.title}`}
                  aria-pressed={images.includes(photo.url)}
                  disabled={uploading || (!images.includes(photo.url) && images.length >= 9)}
                  onClick={() =>
                    setImages((old) =>
                      old.includes(photo.url)
                        ? old.filter((url) => url !== photo.url)
                        : [...old, photo.url],
                    )
                  }
                >
                  <img src={photo.url} alt={photo.title} />
                  <span>{images.includes(photo.url) ? images.indexOf(photo.url) + 1 : '○'}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  return (
    <div className={`${s.app} ${feed.feed}`}>
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
          <button type="button" aria-label="发表朋友圈" onClick={() => setPanel('camera')}>
            <svg
              width="25"
              height="25"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M3 7h4l2-3h6l2 3h4v14H3z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </button>
        )}
      </header>
      {!target && (
        <section className={feed.cover} aria-label="我的朋友圈">
          <div className={feed.coverIdentity}>
            <strong>我</strong>
            <span className={feed.selfAvatar}>我</span>
          </div>
        </section>
      )}
      {panel === 'camera' && (
        <div className={feed.sheetBackdrop} onClick={() => setPanel(null)}>
          <section
            className={feed.sheet}
            role="dialog"
            aria-label="发表朋友圈"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              onClick={() => {
                setComposing(true);
                setPanel('photos');
              }}
            >
              从相册选择照片
            </button>
            <button
              onClick={() => {
                setComposing(true);
                setPanel(null);
              }}
            >
              发表文字
            </button>
            <button onClick={() => setPanel(null)}>取消</button>
          </section>
        </div>
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
                  {canWrite && (
                    <span className={feed.postActions}>
                      <button
                        type="button"
                        aria-label={`${m.name}的动态操作`}
                        onClick={() => setMenu(menu === m.key ? null : m.key)}
                      >
                        ···
                      </button>
                      {menu === m.key && (
                        <span className={feed.actionMenu}>
                          <button
                            disabled={saving !== null}
                            onClick={() => {
                              void like(
                                m.key,
                                m.likes?.some((entry) => entry.actorId === 'player'),
                              );
                              setMenu(null);
                            }}
                          >
                            {m.likes?.some((entry) => entry.actorId === 'player')
                              ? '取消赞'
                              : '♡ 赞'}
                          </button>
                          <button
                            onClick={() => {
                              setCommentKey(m.key);
                              setComment('');
                              setMenu(null);
                            }}
                          >
                            评论
                          </button>
                        </span>
                      )}
                    </span>
                  )}
                  {commentKey === m.key && (
                    <form
                      className={feed.commentComposer}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void sendComment();
                      }}
                    >
                      <input
                        autoFocus
                        aria-label="评论内容"
                        placeholder={`评论${m.name}`}
                        maxLength={500}
                        value={comment}
                        disabled={saving !== null}
                        onChange={(event) => setComment(event.target.value)}
                      />
                      <button disabled={!comment.trim() || saving !== null}>发送</button>
                      <button
                        type="button"
                        disabled={saving !== null}
                        onClick={() => setCommentKey(null)}
                      >
                        取消
                      </button>
                    </form>
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
