'use client';

import { useEffect, useRef, useState } from 'react';
import { characterPreview, characterPreviewTime } from './publisher-character-model.ts';
import {
  addHistoryMessage,
  addMoment,
  editHistoryMessage,
  editMoment,
  editPublicProfile,
  historyAttachment,
  historySegments,
  removeHistoryMessage,
  removeMoment,
  type Speaker,
  type HistoryAttachment,
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
  /** The workbench owns the authenticated, private upload; this editor stores only its asset ID. */
  uploadAttachment?: (file: File) => Promise<HistoryAttachment & { url?: string }>;
  previewAttachment?: (assetId: string) => string;
};
type Page = 'chat' | 'profile' | 'moments';
function localMediaKind(file: File): HistoryAttachment['kind'] | undefined {
  if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      (!file.type && /\.(?:jpe?g|png|webp)$/i.test(file.name)))
    return 'image';
  if (file.type === 'video/mp4' || (!file.type && /\.mp4$/i.test(file.name))) return 'video';
  return undefined;
}

export function PublisherCharacterSocialEditor({
  content,
  actorKey,
  referenceAt,
  canEdit,
  busy,
  onChange,
  uploadAttachment,
  previewAttachment,
}: Props) {
  const [page, setPage] = useState<Page>('chat');
  const [speaker, setSpeaker] = useState<Speaker>('actor');
  const [messageText, setMessageText] = useState('');
  const [messageAttachment, setMessageAttachment] = useState<HistoryAttachment | null>(null);
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState('');
  const [uploading, setUploading] = useState(false);
  const [editingMessage, setEditingMessage] = useState<string | null>(null);
  const [nextInterval, setNextInterval] = useState(false);
  const [postOpen, setPostOpen] = useState(false);
  const [postText, setPostText] = useState('');
  const [postDay, setPostDay] = useState('');
  const [editingPost, setEditingPost] = useState<string | null>(null);
  const [postImage, setPostImage] = useState<string>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mediaInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setPage('chat');
    setSpeaker('actor');
    setMessageText('');
    setMessageAttachment(null);
    setAttachmentFile(null);
    setAttachmentPreview('');
    setEditingMessage(null);
    setNextInterval(false);
    setPostOpen(false);
    setPostText('');
    setPostDay('');
    setPostImage('');
    setEditingPost(null);
    setError('');
    setNotice('');
  }, [actorKey]);
  useEffect(
    () => () => {
      if (attachmentPreview.startsWith('blob:')) URL.revokeObjectURL(attachmentPreview);
    },
    [attachmentPreview],
  );
  const person = characterPreview(content, actorKey);
  if (!person) return <p className={s.empty}>请先核对人物资料，重复的人物暂不能编辑微信。</p>;
  const name = person.name || '未命名人物';
  const disabled = busy || uploading || !canEdit;
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
    result: { content: Record<string, unknown>; error?: string; notice?: string },
    done: () => void,
  ) => {
    if (result.error) return setError(result.error);
    setError('');
    setNotice(result.notice ?? '');
    onChange(result.content);
    done();
  };
  const resetMessage = () => {
    setMessageText('');
    setMessageAttachment(null);
    setAttachmentFile(null);
    setAttachmentPreview('');
    setEditingMessage(null);
    setNextInterval(false);
  };
  const submitMessage = async () => {
    if (disabled) return;
    let attachment = messageAttachment;
    if (attachmentFile) {
      if (!uploadAttachment) return setError('暂时无法上传图片或视频，请刷新后重试。');
      setUploading(true);
      setError('');
      try {
        const uploaded = await uploadAttachment(attachmentFile);
        attachment = historyAttachment(uploaded) ?? null;
        if (!attachment) throw new Error('上传未返回可保存的素材，请重试。');
        setMessageAttachment(attachment);
        setAttachmentFile(null);
        setAttachmentPreview(uploaded.url ?? '');
      } catch (error) {
        setError(error instanceof Error ? error.message : '上传失败，原文件仍在这里，请重试。');
        setUploading(false);
        return;
      }
      setUploading(false);
    }
    const result = editingMessage
      ? editHistoryMessage(content, actorKey, editingMessage, speaker, messageText, attachment)
      : addHistoryMessage(
          content,
          actorKey,
          speaker,
          messageText,
          nextInterval,
          referenceAt,
          attachment ?? undefined,
        );
    apply(result, resetMessage);
  };
  const submitPost = () => {
    const result = editingPost
      ? editMoment(
          content,
          actorKey,
          editingPost,
          postText,
          postDay || undefined,
          referenceAt,
          postImage,
        )
      : addMoment(content, actorKey, postText, postDay || undefined, referenceAt, postImage);
    apply(result, () => {
      setPostText('');
      setPostDay('');
      setPostImage('');
      setEditingPost(null);
      setPostOpen(false);
    });
  };
  const avatar = (
    <span className={s.avatar} aria-hidden="true">
      {person.avatar ? <img src={person.avatar} alt="" /> : name.slice(0, 1)}
    </span>
  );
  const previewUrl = (assetId: string) => previewAttachment?.(assetId) ?? '';
  const currentPreviewUrl =
    attachmentPreview || (messageAttachment ? previewUrl(messageAttachment.assetId) : '');
  const currentAttachmentKind = attachmentFile
    ? localMediaKind(attachmentFile)
    : messageAttachment?.kind;
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
                    <div className={s.bubble}>
                      {message.text && <span>{message.text}</span>}
                      {message.attachment && (
                        <div className={s.messageMedia}>
                          {previewUrl(message.attachment.assetId) ? (
                            message.attachment.kind === 'image' ? (
                              <img
                                src={previewUrl(message.attachment.assetId)}
                                alt={message.attachment.label || '历史聊天图片'}
                              />
                            ) : (
                              <video
                                src={previewUrl(message.attachment.assetId)}
                                controls
                                playsInline
                                preload="metadata"
                                aria-label={message.attachment.label || '历史聊天视频'}
                              >
                                当前浏览器无法播放这段视频。
                              </video>
                            )
                          ) : (
                            <span>{message.attachment.kind === 'image' ? '图片' : '视频'}</span>
                          )}
                          {message.attachment.label && (
                            <small title={message.attachment.label}>
                              {message.attachment.label}
                            </small>
                          )}
                        </div>
                      )}
                    </div>
                    {canEdit && editableHistoryKeys.has(message.key) && (
                      <div className={s.rowActions}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setEditingMessage(message.key);
                            setMessageText(message.text);
                            setMessageAttachment(message.attachment ?? null);
                            setAttachmentFile(null);
                            setAttachmentPreview('');
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
                                resetMessage();
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
              {(attachmentFile || messageAttachment) && (
                <div className={s.attachmentDraft}>
                  {currentPreviewUrl &&
                    (currentAttachmentKind === 'image' ? (
                      <img src={currentPreviewUrl} alt="待发送图片" />
                    ) : (
                      <video
                        src={currentPreviewUrl}
                        controls
                        playsInline
                        preload="metadata"
                        aria-label="待发送视频"
                      >
                        当前浏览器无法播放这段视频。
                      </video>
                    ))}
                  <span>{attachmentFile?.name || messageAttachment?.label || '已添加素材'}</span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setAttachmentFile(null);
                      setMessageAttachment(null);
                      setAttachmentPreview('');
                    }}
                  >
                    移除
                  </button>
                </div>
              )}
              <div className={s.composerActions}>
                <button
                  type="button"
                  className={`${s.secondary} ${s.fileChoice}`}
                  disabled={disabled || !person.knownAtStart || !uploadAttachment}
                  onClick={() => mediaInput.current?.click()}
                >
                  ＋ 图片或视频
                </button>
                <input
                  ref={mediaInput}
                  className={s.fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,video/mp4,.mp4"
                  disabled={disabled || !person.knownAtStart || !uploadAttachment}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    const kind = localMediaKind(file);
                    if (!kind) {
                      setError('请选择 JPG、PNG、WebP 图片或 MP4 视频。');
                      return;
                    }
                    if (file.size > (kind === 'video' ? 50_000_000 : 10_000_000)) {
                      setError(kind === 'video' ? '视频不能超过 50 MB。' : '图片不能超过 10 MB。');
                      return;
                    }
                    setAttachmentFile(file);
                    setMessageAttachment(null);
                    setAttachmentPreview(URL.createObjectURL(file));
                    setError('');
                  }}
                />
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
                      resetMessage();
                    }}
                  >
                    取消编辑
                  </button>
                )}
                <button
                  type="button"
                  className={s.primary}
                  disabled={
                    disabled ||
                    !person.knownAtStart ||
                    (!messageText.trim() && !attachmentFile && !messageAttachment)
                  }
                  onClick={() => void submitMessage()}
                >
                  {uploading ? '上传中…' : editingMessage ? '保存修改' : '发送到历史'}
                </button>
              </div>
              {nextInterval && !editingMessage && (
                <p className={s.smallHint}>
                  会尝试隔开一天；如果原稿聊天已接近开场，消息仍可加入最后一段。
                </p>
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
              <div style={{ margin: '8px 0' }}>
                <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
                  配图（选填）
                </label>
                {postImage ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <img
                      src={postImage}
                      alt="动态配图预览"
                      style={{
                        width: 80,
                        height: 80,
                        objectFit: 'cover',
                        borderRadius: 6,
                        border: '1px solid #cbd5e1',
                      }}
                    />
                    <button
                      type="button"
                      className={s.secondary}
                      style={{ fontSize: 12, padding: '4px 8px' }}
                      onClick={() => setPostImage('')}
                    >
                      移除图片
                    </button>
                  </div>
                ) : (
                  <label
                    className={s.secondary}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      fontSize: 13,
                      padding: '6px 12px',
                    }}
                  >
                    <span>+ 导入动态配图</span>
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      disabled={disabled}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          const dataUrl = event.target?.result as string;
                          if (dataUrl) setPostImage(dataUrl);
                        };
                        reader.readAsDataURL(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                )}
              </div>
              <p className={s.smallHint}>未选日期时会安排在故事开场前。支持文字与动态配图。</p>
              <div className={s.composerActions}>
                <button
                  type="button"
                  className={s.secondary}
                  onClick={() => {
                    setPostOpen(false);
                    setEditingPost(null);
                    setPostText('');
                    setPostDay('');
                    setPostImage('');
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
            <p className={s.empty}>还没有朋友圈内容。可以发布一条体现人物日常的文字或图文动态。</p>
          )}
          {person.moments.map((post) => (
            <article className={s.post} key={post.key}>
              {avatar}
              <div className={s.postContent}>
                <strong>{name}</strong>
                <p>{post.text}</p>
                {post.image && (
                  <div style={{ marginTop: 8, maxWidth: 260, borderRadius: 8, overflow: 'hidden' }}>
                    <img
                      src={post.image}
                      alt=""
                      style={{
                        width: '100%',
                        maxHeight: 200,
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                  </div>
                )}
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
                        setPostImage(post.image ?? '');
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
      {notice && (
        <p role="status" className={s.smallHint}>
          {notice}
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
