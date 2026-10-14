'use client';

import { useEffect, useState } from 'react';
import { characterPreview, characterPreviewTime } from './publisher-character-model.ts';
import {
  addHistoryMessage,
  addMoment,
  editHistoryMessage,
  editMoment,
  editPublicProfile,
  historySegments,
  removeHistoryMessage,
  removeMoment,
  type Speaker,
} from './publisher-character-social-editor-model.ts';
import s from './publisher-character-social-editor.module.css';

type Props = {
  content: Record<string, unknown>;
  actorKey: string;
  /** Stable work creation time used only until the author sets the world's opening time. */
  referenceAt?: string;
  canEdit: boolean;
  busy: boolean;
  onChange: (content: Record<string, unknown>) => void;
};
type Page = 'chat' | 'profile' | 'moments';

export function PublisherCharacterSocialEditor({
  content,
  actorKey,
  referenceAt,
  canEdit,
  busy,
  onChange,
}: Props) {
  const [page, setPage] = useState<Page>('chat');
  const [speaker, setSpeaker] = useState<Speaker>('actor');
  const [messageText, setMessageText] = useState('');
  const [editingMessage, setEditingMessage] = useState<string | null>(null);
  const [nextInterval, setNextInterval] = useState(false);
  const [postOpen, setPostOpen] = useState(false);
  const [postText, setPostText] = useState('');
  const [postDay, setPostDay] = useState('');
  const [editingPost, setEditingPost] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setPage('chat');
    setSpeaker('actor');
    setMessageText('');
    setEditingMessage(null);
    setNextInterval(false);
    setPostOpen(false);
    setPostText('');
    setPostDay('');
    setEditingPost(null);
    setError('');
  }, [actorKey]);
  const person = characterPreview(content, actorKey);
  if (!person) return <p className={s.empty}>请先核对人物资料，重复的人物暂不能编辑微信。</p>;
  const name = person.name || '未命名人物';
  const disabled = busy || !canEdit;
  const history = historySegments(content, actorKey);
  const editableHistoryKeys = new Set(
    (Array.isArray((content.phone as Record<string, unknown> | undefined)?.messages)
      ? ((content.phone as Record<string, unknown>).messages as Record<string, unknown>[])
      : []
    )
      .filter((entry) => entry.actorKey === actorKey && entry.origin === 'history')
      .map((entry) => entry.key),
  );

  const apply = (
    result: { content: Record<string, unknown>; error?: string },
    done: () => void,
  ) => {
    if (result.error) return setError(result.error);
    setError('');
    onChange(result.content);
    done();
  };
  const submitMessage = () => {
    const result = editingMessage
      ? editHistoryMessage(content, actorKey, editingMessage, speaker, messageText)
      : addHistoryMessage(content, actorKey, speaker, messageText, nextInterval, referenceAt);
    apply(result, () => {
      setMessageText('');
      setEditingMessage(null);
      setNextInterval(false);
    });
  };
  const submitPost = () => {
    const result = editingPost
      ? editMoment(content, actorKey, editingPost, postText, postDay || undefined, referenceAt)
      : addMoment(content, actorKey, postText, postDay || undefined, referenceAt);
    apply(result, () => {
      setPostText('');
      setPostDay('');
      setEditingPost(null);
      setPostOpen(false);
    });
  };
  const avatar = (
    <span className={s.avatar} aria-hidden="true">
      {person.avatar ? <img src={person.avatar} alt="" /> : name.slice(0, 1)}
    </span>
  );
  return (
    <section className={s.shell} aria-label={`${name}的微信内容`}>
      <div className={s.topbar}>
        {page !== 'chat' ? (
          <button
            type="button"
            className={s.back}
            onClick={() => setPage(page === 'moments' ? 'profile' : 'chat')}
          >
            ‹ 返回
          </button>
        ) : (
          <span className={s.backSpacer} />
        )}
        <strong>{page === 'moments' ? `${name}的朋友圈` : name}</strong>
        {page === 'moments' ? (
          <button
            type="button"
            className={s.topAction}
            disabled={disabled || !person.knownAtStart}
            onClick={() => setPostOpen(true)}
          >
            发布
          </button>
        ) : (
          <button type="button" className={s.topAction} onClick={() => setPage('profile')}>
            资料
          </button>
        )}
      </div>

      {page === 'chat' && (
        <>
          <div className={s.chatBody}>
            {history.length === 0 && (
              <p className={s.empty}>这段关系还没有写入历史聊天。可以从下面发第一条消息。</p>
            )}
            {history.map((message, index) => (
              <div key={message.key}>
                {(index === 0 || message.intervalBefore) && (
                  <div className={s.interval}>
                    {message.intervalBefore ? '隔了一段时间' : '此前的聊天'}
                    <time dateTime={message.at} title={characterPreviewTime(message.at)}>
                      {characterPreviewTime(message.at)}
                    </time>
                  </div>
                )}
                <div
                  className={`${s.messageRow} ${message.speaker === 'player' ? s.fromPlayer : ''}`}
                >
                  {message.speaker === 'actor' && avatar}
                  <div className={s.messageBlock}>
                    <div className={s.bubble}>{message.text}</div>
                    {canEdit && editableHistoryKeys.has(message.key) && (
                      <div className={s.rowActions}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setEditingMessage(message.key);
                            setMessageText(message.text);
                            setSpeaker(message.speaker);
                            setNextInterval(false);
                            setError('');
                          }}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            apply(removeHistoryMessage(content, actorKey, message.key), () => {
                              if (editingMessage === message.key) {
                                setEditingMessage(null);
                                setMessageText('');
                              }
                            })
                          }
                        >
                          删除
                        </button>
                      </div>
                    )}
                  </div>
                  {message.speaker === 'player' && (
                    <span className={`${s.avatar} ${s.playerAvatar}`} aria-hidden="true">
                      我
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          {canEdit && (
            <div className={s.composer}>
              <div className={s.senderRow} role="group" aria-label="选择发送人">
                <span>发送人</span>
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={speaker === 'actor'}
                  onClick={() => setSpeaker('actor')}
                >
                  {name}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={speaker === 'player'}
                  onClick={() => setSpeaker('player')}
                >
                  主角
                </button>
              </div>
              <label className={s.srOnly} htmlFor="history-message">
                历史消息内容
              </label>
              <textarea
                id="history-message"
                rows={2}
                maxLength={500}
                disabled={disabled || !person.knownAtStart}
                placeholder="写一条过去的微信消息…"
                value={messageText}
                onChange={(event) => setMessageText(event.target.value)}
              />
              <div className={s.composerActions}>
                <button
                  type="button"
                  className={s.secondary}
                  disabled={disabled || Boolean(editingMessage) || !person.knownAtStart}
                  aria-pressed={nextInterval}
                  onClick={() => setNextInterval((value) => !value)}
                >
                  {nextInterval ? '已隔一段时间 ✓' : '＋ 隔一段时间'}
                </button>
                {editingMessage && (
                  <button
                    type="button"
                    className={s.secondary}
                    onClick={() => {
                      setEditingMessage(null);
                      setMessageText('');
                    }}
                  >
                    取消编辑
                  </button>
                )}
                <button
                  type="button"
                  className={s.primary}
                  disabled={disabled || !person.knownAtStart || !messageText.trim()}
                  onClick={submitMessage}
                >
                  {editingMessage ? '保存修改' : '发送到历史'}
                </button>
              </div>
              {nextInterval && !editingMessage && (
                <p className={s.smallHint}>下一条消息会进入新的聊天时间段，保存后时间固定。</p>
              )}
            </div>
          )}
        </>
      )}

      {page === 'profile' && (
        <div className={s.profile}>
          <div className={s.profileHead}>
            {avatar}
            <div>
              <h3>{name}</h3>
              <p>{person.identity || '尚未填写公开身份'}</p>
            </div>
          </div>
          {canEdit ? (
            <>
              <label>
                好友资料中的身份
                <input
                  maxLength={160}
                  disabled={disabled}
                  value={person.identity}
                  onChange={(event) =>
                    onChange(editPublicProfile(content, actorKey, 'identity', event.target.value))
                  }
                  placeholder="例如：你的老同学、书店店主"
                />
              </label>
              <label>
                给玩家看的介绍
                <textarea
                  rows={4}
                  maxLength={1600}
                  disabled={disabled}
                  value={person.introduction}
                  onChange={(event) =>
                    onChange(
                      editPublicProfile(content, actorKey, 'introduction', event.target.value),
                    )
                  }
                  placeholder="写玩家打开好友资料时能看到的介绍"
                />
              </label>
            </>
          ) : (
            <p className={s.publicIntro}>{person.introduction || '暂无公开介绍。'}</p>
          )}
          <button type="button" className={s.profileLink} onClick={() => setPage('moments')}>
            <span>朋友圈</span>
            <span>{person.moments.length ? `${person.moments.length} 条 ›` : '查看 ›'}</span>
          </button>
          <button type="button" className={s.profileLink} onClick={() => setPage('chat')}>
            <span>发消息</span>
            <span>›</span>
          </button>
          <p className={s.smallHint}>这里展示玩家能看到的资料。人物的私下想法仍留在左侧设定中。</p>
        </div>
      )}

      {page === 'moments' && (
        <div className={s.moments}>
          <div className={s.momentCover}>
            <div className={s.momentAuthor}>
              {name}
              {avatar}
            </div>
          </div>
          {postOpen && canEdit && (
            <div className={s.postComposer}>
              <h3>{editingPost ? '编辑朋友圈' : '发布朋友圈草稿'}</h3>
              <label>
                正文
                <textarea
                  rows={4}
                  maxLength={1600}
                  disabled={disabled}
                  value={postText}
                  onChange={(event) => setPostText(event.target.value)}
                  placeholder="分享 TA 当时的生活…"
                />
              </label>
              <label>
                发布日期（选填）
                <input
                  type="date"
                  disabled={disabled}
                  value={postDay}
                  onChange={(event) => setPostDay(event.target.value)}
                />
              </label>
              <p className={s.smallHint}>
                未选日期时会安排在故事开场前。当前朋友圈支持文字；图片尚未接入发布。
              </p>
              <div className={s.composerActions}>
                <button
                  type="button"
                  className={s.secondary}
                  onClick={() => {
                    setPostOpen(false);
                    setEditingPost(null);
                    setPostText('');
                    setPostDay('');
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className={s.primary}
                  disabled={disabled || !postText.trim()}
                  onClick={submitPost}
                >
                  {editingPost ? '保存修改' : '加入朋友圈草稿'}
                </button>
              </div>
            </div>
          )}
          {person.moments.length === 0 && (
            <p className={s.empty}>还没有朋友圈内容。可以发布一条体现人物日常的文字动态。</p>
          )}
          {person.moments.map((post) => (
            <article className={s.post} key={post.key}>
              {avatar}
              <div className={s.postContent}>
                <strong>{name}</strong>
                <p>{post.text}</p>
                <time dateTime={post.at}>{characterPreviewTime(post.at)}</time>
                {canEdit && (
                  <div className={s.rowActions}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setEditingPost(post.key);
                        setPostText(post.text);
                        setPostDay('');
                        setPostOpen(true);
                        setError('');
                      }}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        onChange(removeMoment(content, actorKey, post.key));
                        setError('');
                      }}
                    >
                      删除
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {!person.knownAtStart && (
        <p className={s.notice}>
          这位人物开场尚未与主角认识，暂不预设双方历史聊天或已可见的朋友圈。
        </p>
      )}
    </section>
  );
}
