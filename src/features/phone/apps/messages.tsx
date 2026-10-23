import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { parseStickerText, STICKER_LABELS, type StickerId } from '../stickers.ts';
import type { PhoneAppContext } from '../phone-shell.tsx';
import type { PhoneContact, PhonePhoto } from './types.ts';
import { usePhoneApps } from './provider.tsx';
import { Avatar, Empty, Feedback, Links, Search } from './common.tsx';
import { findRelatedInvitation } from './appointment-link.ts';
import { PersonCard } from './person-card.tsx';
import { formatChatTime, searchable, timeText, dayKey } from './helpers.ts';
import { playSendSound, playTapSound } from '../audio-feedback.ts';
import s from './apps.module.css';
import { hasInFlightLocalSend, hasLocalSendFailure } from '../chat-send-state.ts';
import { Id } from '../../../contracts/api.ts';
import { useGroups } from '../groups/use-groups.ts';
import { GroupCreate } from '../groups/group-create.tsx';
import { GroupListRows } from '../groups/group-list.tsx';
import { GroupChat } from '../groups/group-chat.tsx';
import { groupTarget, parseGroupTarget } from '../groups/state.ts';
import { AuthoredSocialSchema, type AuthoredSocial } from '../../../contracts/authored-social.ts';
import profile from './friend-profile.module.css';

const EMOJI_LIST = [
  '😊',
  '😂',
  '🤣',
  '❤️',
  '👍',
  '🙏',
  '🎉',
  '✨',
  '🔥',
  '👏',
  '🥳',
  '😎',
  '🤔',
  '👀',
  '💡',
  '☕',
  '🍻',
  '🍰',
  '🌸',
  '☀️',
  '🌙',
  '⭐',
  '🎈',
  '🤝',
  '💪',
  '💯',
  '🚀',
  '💌',
  '💼',
  '📍',
  '🕒',
  '🆗',
];

export function MessagesApp({ target, open }: PhoneAppContext) {
  const {
    worldId,
    transport,
    data,
    actions,
    drafts,
    setDraft,
    operations,
    run,
    onReload,
    groups: sharedGroups,
  } = usePhoneApps();
  const fallbackGroups = useGroups(
    worldId,
    !sharedGroups && Id.safeParse(worldId).success && Boolean(actions.sendMessage),
    onReload,
  );
  const groups = sharedGroups ?? fallbackGroups;
  const [creatingGroup, setCreatingGroup] = useState(false);
  const groupId = parseGroupTarget(target);
  const [tab, setTab] = useState<'chats' | 'contacts' | 'discover' | 'me'>('chats');
  const [query, setQuery] = useState('');
  const [showPerson, setShowPerson] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [callNotice, setCallNotice] = useState<string | null>(null);
  const [callingContact, setCallingContact] = useState<PhoneContact | null>(null);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [showEmojiKeyboard, setShowEmojiKeyboard] = useState(false);
  const [showDropdownMenu, setShowDropdownMenu] = useState(false);
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);
  const [appointmentNotice, setAppointmentNotice] = useState('');
  const [appointmentConfirm, setAppointmentConfirm] = useState(false);
  const [previewModalPhoto, setPreviewModalPhoto] = useState<PhonePhoto | null>(null);
  const [socialPreview, setSocialPreview] = useState<{
    worldId: string;
    actorId: string;
    status: 'ready' | 'error';
    moments: AuthoredSocial['moments'];
  } | null>(null);
  const [previewRetry, setPreviewRetry] = useState(0);

  const messageScroll = useRef<HTMLDivElement>(null);
  const wasNearBottom = useRef(true);
  const lastScroll = useRef(0);
  const readAttempt = useRef<string | undefined>(undefined);

  const actor = data.contacts.find((c) => c.id === target);
  const profileId = selectedProfileId ?? (showPerson ? actor?.id : undefined);
  const profileContact = data.contacts.find((c) => c.id === profileId);
  const profileSocial =
    socialPreview?.worldId === worldId && socialPreview.actorId === profileId
      ? socialPreview
      : null;
  useEffect(() => {
    if (!profileId) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await (transport ?? fetch)(
          `/api/v1/worlds/${encodeURIComponent(worldId)}/social`,
          { signal: controller.signal },
        );
        if (!response.ok) throw Error('social unavailable');
        const parsed = AuthoredSocialSchema.parse(await response.json());
        if (!controller.signal.aborted)
          setSocialPreview({
            worldId,
            actorId: profileId,
            status: 'ready',
            moments: parsed.moments
              .filter((moment) => moment.actorId === profileId)
              .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
          });
      } catch {
        if (!controller.signal.aborted)
          setSocialPreview({ worldId, actorId: profileId, status: 'error', moments: [] });
      }
    };
    void load();
    return () => controller.abort();
  }, [worldId, profileId, transport, previewRetry]);
  const messages = data.messages
    .filter((m) => m.actorId === target)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const key = `message:${target}`,
    text = drafts[key] ?? '',
    operation = operations[key];
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const localFailure = hasLocalSendFailure(operation, messages, operations);
  useEffect(() => {
    if (!target || drafts[key] !== undefined) return;
    try {
      const saved = sessionStorage.getItem(`pl-message-draft:${worldId}:${target}`);
      if (saved !== null) setDraft(key, saved);
    } catch {
      /* Keep current-screen drafts when storage is unavailable. */
    }
  }, [worldId, key]);
  useEffect(() => {
    if (!target || drafts[key] === undefined) return;
    try {
      const storageKey = `pl-message-draft:${worldId}:${target}`;
      if (text) sessionStorage.setItem(storageKey, text);
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* The provider still owns the current-screen draft. */
    }
  }, [worldId, key, text, drafts[key] === undefined]);
  useEffect(() => {
    setAppointmentNotice('');
    setAppointmentConfirm(false);
  }, [target]);

  const totalUnread =
    data.contacts.reduce((sum, c) => sum + (c.unread || 0), 0) +
    Object.values(groups.details).reduce((sum, group) => sum + group.unread, 0);

  useLayoutEffect(() => {
    const el = messageScroll.current;
    if (el) {
      el.scrollTop =
        drafts[`scroll:${target}`] === undefined
          ? el.scrollHeight
          : Number(drafts[`scroll:${target}`]);
      lastScroll.current = el.scrollTop;
      wasNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    }
  }, [target, profileId]);

  useLayoutEffect(() => {
    const el = messageScroll.current;
    if (el && wasNearBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    const el = messageScroll.current;
    if (!el || !actor) return;
    let previousHeight = el.clientHeight;
    const readSignature = `${actor.id}:${actor.unread}:${messages.at(-1)?.id ?? ''}`;
    const observe = () => {
      if (el.clientHeight === 0) {
        previousHeight = 0;
        return;
      }
      if (previousHeight === 0) el.scrollTop = lastScroll.current;
      previousHeight = el.clientHeight;
      if (
        document.visibilityState === 'visible' &&
        actor.unread > 0 &&
        actions.markRead &&
        readAttempt.current !== readSignature
      ) {
        readAttempt.current = readSignature;
        void run(`read:${actor.id}`, readSignature, async () => {
          await actions.markRead!(actor.id);
          return { status: 'committed' };
        });
      }
    };
    const resize = new ResizeObserver(observe);
    resize.observe(el);
    document.addEventListener('visibilitychange', observe);
    observe();
    return () => {
      resize.disconnect();
      document.removeEventListener('visibilitychange', observe);
    };
  }, [actor?.id, actor?.unread, actions.markRead, messages.at(-1)?.id]);

  if (creatingGroup)
    return (
      <GroupCreate
        groups={groups}
        contacts={data.contacts}
        close={() => setCreatingGroup(false)}
        created={(id) => {
          setCreatingGroup(false);
          open('messages', groupTarget(id));
        }}
      />
    );
  if (groupId && groups.enabled)
    return (
      <GroupChat
        key={groupId}
        id={groupId}
        groups={groups}
        contacts={data.contacts}
        back={() => open('messages')}
      />
    );
  if (profileContact) {
    const closeProfile = () => {
      setShowPerson(false);
      setSelectedProfileId(null);
    };
    return (
      <div className={profile.page} data-phone-fixed-dock data-phone-friend-profile>
        <header className={profile.header}>
          <button type="button" onClick={closeProfile} aria-label="返回上一页">
            ‹ <span>返回</span>
          </button>
          <h2>朋友资料</h2>
          <span aria-hidden="true" />
        </header>
        <div className={profile.scroll}>
          <section className={profile.identity} aria-label={`${profileContact.name}的资料`}>
            <Avatar url={profileContact.avatarUrl} name={profileContact.name} />
            <div>
              <h3>{profileContact.name}</h3>
              {profileContact.relationship && <p>{profileContact.relationship}</p>}
            </div>
          </section>
          <section className={profile.introduction} aria-label="公开介绍">
            <h3>关于 TA</h3>
            <p>{profileContact.summary?.trim() || 'TA 还没有公开介绍。'}</p>
          </section>
          <button
            type="button"
            className={profile.moments}
            aria-label={`查看${profileContact.name}的朋友圈`}
            onClick={() => {
              closeProfile();
              open('moments', profileContact.id);
            }}
          >
            <span className={profile.momentsTitle}>朋友圈</span>
            <span className={profile.momentsPreview}>
              {!profileSocial ? (
                '正在读取动态…'
              ) : profileSocial.status === 'error' ? (
                '动态暂时无法读取，点此查看'
              ) : profileSocial.moments.length ? (
                <span className={profile.previewLines}>
                  {profileSocial.moments.slice(0, 2).map((moment) => (
                    <span key={moment.key}>{moment.text}</span>
                  ))}
                </span>
              ) : (
                'TA 还没有动态'
              )}
            </span>
            <span className={profile.chevron} aria-hidden="true">
              ›
            </span>
          </button>
          {profileSocial?.status === 'error' && (
            <button
              type="button"
              className={profile.retry}
              onClick={() => setPreviewRetry((value) => value + 1)}
            >
              重新读取动态
            </button>
          )}
        </div>
        <footer className={profile.footer}>
          <button
            type="button"
            onClick={() => {
              const id = profileContact.id;
              closeProfile();
              open('messages', id);
            }}
          >
            发消息
          </button>
          <button type="button" onClick={() => setCallingContact(profileContact)}>
            拨打电话
          </button>
        </footer>
        {callingContact && (
          <CallModal
            contact={callingContact}
            onClose={() => setCallingContact(null)}
            onOpenChat={(id) => {
              setCallingContact(null);
              closeProfile();
              open('messages', id);
            }}
          />
        )}
      </div>
    );
  }
  if (target && !actor) return <Empty title="找不到这个联系人" text="请返回通讯录或刷新后再试。" />;

  // -------------------------------------------------------------------------
  // 微信主页视图（4-Tab 模式）
  // -------------------------------------------------------------------------
  if (!actor) {
    const contacts = data.contacts.filter((c) => searchable(query, c.name, c.relationship));
    const sortedChats = [...contacts].sort((a, b) => {
      const latestA = data.messages
        .filter((m) => m.actorId === a.id)
        .sort((x, y) => Date.parse(x.at) - Date.parse(y.at))
        .at(-1);
      const latestB = data.messages
        .filter((m) => m.actorId === b.id)
        .sort((x, y) => Date.parse(x.at) - Date.parse(y.at))
        .at(-1);
      const timeA = latestA?.at ?? '';
      const timeB = latestB?.at ?? '';
      return (Date.parse(timeB) || 0) - (Date.parse(timeA) || 0);
    });
    const getTitle = () => {
      switch (tab) {
        case 'chats':
          return `微信${totalUnread > 0 ? ` (${totalUnread})` : ''}`;
        case 'contacts':
          return '通讯录';
        case 'discover':
          return '发现';
        case 'me':
          return '我';
      }
    };
    const selectedProfile = data.contacts.find((c) => c.id === selectedProfileId);

    return (
      <div
        className={s.app}
        data-phone-fixed-dock
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          padding: 0,
          overflow: 'hidden',
          background: tab === 'chats' || tab === 'contacts' ? '#ededed' : '#f7f7f7',
          position: 'relative',
        }}
      >
        {/* 原生微信顶栏 NavBar */}
        <header
          style={{
            height: '44px',
            background: '#ededed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 14px',
            borderBottom: '1px solid #dcdcdc',
            boxSizing: 'border-box',
            flexShrink: 0,
            position: 'relative',
            zIndex: 30,
          }}
        >
          <div style={{ fontSize: '17px', fontWeight: 600, color: '#111827' }}>{getTitle()}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <button
              type="button"
              title="更多功能"
              aria-label="更多功能"
              onClick={() => {
                playTapSound();
                setShowDropdownMenu((v) => !v);
              }}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '20px',
                color: '#1f2937',
                cursor: 'pointer',
                padding: '2px 4px',
                lineHeight: 1,
              }}
            >
              ⊕
            </button>
          </div>

          {/* 微信原生右上角黑色下拉气泡菜单 */}
          {showDropdownMenu && (
            <div
              style={{
                position: 'absolute',
                top: '44px',
                right: '10px',
                background: '#4c4c4c',
                borderRadius: '8px',
                padding: '4px 0',
                width: '140px',
                boxShadow: '0 6px 20px rgba(0,0,0,0.3)',
                zIndex: 100,
              }}
              onClick={() => setShowDropdownMenu(false)}
            >
              {[
                ...(groups.enabled
                  ? [{ icon: '💬', label: '发起群聊', action: () => setCreatingGroup(true) }]
                  : []),
                { icon: '👤', label: '添加朋友', action: () => setTab('contacts') },
                { icon: '📷', label: '扫一扫', action: () => open('photos') },
                { icon: '💳', label: '收付款', action: () => setTab('me') },
              ].map((item, idx) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={item.action}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '100%',
                    padding: '10px 14px',
                    background: 'none',
                    border: 'none',
                    borderBottom: idx < 3 ? '1px solid #5a5a5a' : 'none',
                    color: '#ffffff',
                    fontSize: '14px',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: '15px' }}>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </header>

        {/* 主体滚动区域 */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            background: tab === 'chats' || tab === 'contacts' ? '#ffffff' : '#f7f7f7',
          }}
        >
          {/* Tab 1: 微信消息列表 */}
          {tab === 'chats' && (
            <div>
              <div style={{ padding: '8px 12px', background: '#ededed' }}>
                <Search label="搜索" value={query} onChange={setQuery} />
              </div>
              <GroupListRows
                groups={groups}
                contacts={data.contacts}
                query={query}
                open={(id) => open('messages', groupTarget(id))}
              />
              <div className={s.list} style={{ padding: 0 }}>
                {sortedChats.map((c) => {
                  const latest = data.messages
                    .filter((m) => m.actorId === c.id)
                    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
                    .at(-1);
                  return (
                    <button
                      key={c.id}
                      className={s.contact}
                      onClick={() => {
                        playTapSound();
                        open('messages', c.id);
                      }}
                      style={{
                        padding: '10px 14px',
                        borderBottom: '1px solid #f1f5f9',
                        borderRadius: 0,
                      }}
                    >
                      <div style={{ position: 'relative' }}>
                        <Avatar
                          url={c.avatarUrl}
                          name={c.name}
                          kind={c.avatarKind}
                          label={c.avatarLabel}
                        />
                        {c.unread > 0 && (
                          <span
                            style={{
                              position: 'absolute',
                              top: '-4px',
                              right: '-4px',
                              background: '#ef4444',
                              color: '#ffffff',
                              borderRadius: '10px',
                              padding: '1px 5px',
                              fontSize: '11px',
                              fontWeight: 700,
                              lineHeight: 1.2,
                              minWidth: '16px',
                              textAlign: 'center',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                            }}
                          >
                            {c.unread > 99 ? '99+' : c.unread}
                          </span>
                        )}
                      </div>
                      <span className={s.contactText} style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <strong style={{ fontSize: '15px', color: '#111827' }}>{c.name}</strong>
                          {latest && (
                            <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                              {formatChatTime(latest.at, data.referenceTime)}
                            </span>
                          )}
                        </div>
                        <small
                          style={{
                            display: 'block',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: '210px',
                            color: '#6b7280',
                            fontSize: '13px',
                            marginTop: '2px',
                          }}
                        >
                          {latest
                            ? latest.text.trim() ||
                              (latest.stickerId
                                ? `[${STICKER_LABELS[latest.stickerId as StickerId] ?? '表情'}]`
                                : latest.photo
                                  ? latest.photo.mediaType === 'video'
                                    ? '[视频]'
                                    : '[图片]'
                                  : latest.attachment?.kind === 'image'
                                    ? '[图片]'
                                    : latest.attachment?.kind === 'video'
                                      ? '[视频]'
                                      : '开始聊聊')
                            : '开始聊聊'}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </div>
              {!contacts.length && !groups.list?.groups.length && (
                <Empty
                  title={query ? '没有找到聊天' : '还没有聊天'}
                  text="世界中的人物会出现在这里。"
                />
              )}
            </div>
          )}

          {/* Tab 2: 通讯录 */}
          {tab === 'contacts' && (
            <div>
              <div style={{ padding: '8px 12px', background: '#ededed' }}>
                <Search label="搜索联系人" value={query} onChange={setQuery} />
              </div>

              <div
                style={{
                  padding: '6px 16px',
                  fontSize: '12px',
                  color: '#6b7280',
                  background: '#f8fafc',
                }}
              >
                平行人生联系人 ({contacts.length})
              </div>

              <div className={s.list} style={{ padding: 0 }}>
                {contacts.map((c) => (
                  <button
                    key={c.id}
                    className={s.contact}
                    onClick={() => {
                      playTapSound();
                      setSelectedProfileId(c.id);
                    }}
                    style={{
                      padding: '10px 16px',
                      borderBottom: '1px solid #f3f4f6',
                      borderRadius: 0,
                    }}
                  >
                    <Avatar
                      url={c.avatarUrl}
                      name={c.name}
                      kind={c.avatarKind}
                      label={c.avatarLabel}
                    />
                    <span className={s.contactText} style={{ flex: 1 }}>
                      <strong
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '15px',
                        }}
                      >
                        {c.name}
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 'normal',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            background: '#e2e8f0',
                            color: '#475569',
                          }}
                        >
                          {c.relationship}
                        </span>
                      </strong>
                      <small style={{ color: '#64748b', fontSize: '12px' }}>
                        {c.summary
                          ? c.summary.length > 26
                            ? c.summary.slice(0, 26) + '…'
                            : c.summary
                          : '查看人物名片'}
                      </small>
                    </span>
                    <span style={{ fontSize: '13px', color: '#9ca3af' }}>名片 ›</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tab 3: 发现（朋友圈入口） */}
          {tab === 'discover' && (
            <div style={{ padding: '10px 0' }}>
              <div
                style={{
                  background: '#ffffff',
                  borderTop: '1px solid #e5e7eb',
                  borderBottom: '1px solid #e5e7eb',
                  marginBottom: '10px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 16px',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    playTapSound();
                    open('moments');
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        background: 'linear-gradient(135deg, #f59e0b, #ec4899)',
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '18px',
                      }}
                    >
                      📷
                    </div>
                    <span style={{ fontSize: '16px', fontWeight: 500, color: '#111827' }}>
                      朋友圈
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: '#ef4444',
                      }}
                    />
                    <span style={{ fontSize: '13px', color: '#9ca3af' }}>好友动态 ›</span>
                  </div>
                </div>
              </div>

              <div
                style={{
                  background: '#ffffff',
                  borderTop: '1px solid #e5e7eb',
                  borderBottom: '1px solid #e5e7eb',
                  marginBottom: '10px',
                }}
              >
                {[
                  { icon: '🎬', label: '视频号', tip: '关注的朋友正在分享' },
                  { icon: '📡', label: '直播', tip: '' },
                ].map((item, idx) => (
                  <div
                    key={item.label}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 16px',
                      borderBottom: idx === 0 ? '1px solid #f3f4f6' : 'none',
                      cursor: 'pointer',
                    }}
                    onClick={() => playTapSound()}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <span style={{ fontSize: '20px' }}>{item.icon}</span>
                      <span style={{ fontSize: '16px', color: '#111827' }}>{item.label}</span>
                    </div>
                    <span style={{ fontSize: '12px', color: '#9ca3af' }}>{item.tip} ›</span>
                  </div>
                ))}
              </div>

              <div
                style={{
                  background: '#ffffff',
                  borderTop: '1px solid #e5e7eb',
                  borderBottom: '1px solid #e5e7eb',
                }}
              >
                {[
                  { icon: '🔍', label: '搜一搜', tip: '搜索剧情与八卦' },
                  { icon: '🎵', label: '听一听', tip: '背景白噪音' },
                ].map((item, idx) => (
                  <div
                    key={item.label}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 16px',
                      borderBottom: idx === 0 ? '1px solid #f3f4f6' : 'none',
                      cursor: 'pointer',
                    }}
                    onClick={() => playTapSound()}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <span style={{ fontSize: '20px' }}>{item.icon}</span>
                      <span style={{ fontSize: '16px', color: '#111827' }}>{item.label}</span>
                    </div>
                    <span style={{ fontSize: '12px', color: '#9ca3af' }}>{item.tip} ›</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab 4: 我（主角个人微信主页） */}
          {tab === 'me' && (
            <div style={{ padding: '10px 0' }}>
              <div
                style={{
                  background: '#ffffff',
                  padding: '20px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  borderTop: '1px solid #e5e7eb',
                  borderBottom: '1px solid #e5e7eb',
                  marginBottom: '10px',
                }}
              >
                <div
                  style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '8px',
                    background: '#07c160',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '22px',
                    flexShrink: 0,
                  }}
                >
                  我
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '18px', fontWeight: 600, color: '#111827' }}>我</div>
                  <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
                    微信号：wxid_parallel_user
                  </div>
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      color: '#07c160',
                      border: '1px solid #86efac',
                      borderRadius: '12px',
                      padding: '1px 8px',
                      marginTop: '6px',
                    }}
                  >
                    <span>+ 探索中</span>
                  </div>
                </div>
                <div style={{ fontSize: '18px', color: '#9ca3af' }}>二维码 ›</div>
              </div>

              <div
                style={{
                  background: '#ffffff',
                  borderTop: '1px solid #e5e7eb',
                  borderBottom: '1px solid #e5e7eb',
                  marginBottom: '10px',
                }}
              >
                {[
                  { icon: '💳', label: '服务与钱包', tip: '余额 ¥12,850.00' },
                  { icon: '⭐', label: '收藏', tip: '3 项灵感' },
                  { icon: '🖼️', label: '朋友圈相册', tip: '进入', action: () => open('moments') },
                  { icon: '📇', label: '卡包与钥匙', tip: '' },
                ].map((item, idx) => (
                  <div
                    key={item.label}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 16px',
                      borderBottom: idx < 3 ? '1px solid #f3f4f6' : 'none',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      playTapSound();
                      if (item.action) item.action();
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <span style={{ fontSize: '18px' }}>{item.icon}</span>
                      <span style={{ fontSize: '15px', color: '#111827' }}>{item.label}</span>
                    </div>
                    <span style={{ fontSize: '13px', color: '#9ca3af' }}>{item.tip} ›</span>
                  </div>
                ))}
              </div>

              <div
                style={{
                  background: '#ffffff',
                  borderTop: '1px solid #e5e7eb',
                  borderBottom: '1px solid #e5e7eb',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 16px',
                    cursor: 'pointer',
                  }}
                  onClick={() => playTapSound()}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <span style={{ fontSize: '18px' }}>⚙️</span>
                    <span style={{ fontSize: '15px', color: '#111827' }}>设置</span>
                  </div>
                  <span style={{ fontSize: '13px', color: '#9ca3af' }}>微信设置 ›</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 原生微信底栏 4-TabBar */}
        <nav
          style={{
            height: '52px',
            background: '#f7f7f7',
            borderTop: '1px solid #dfdfdf',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            boxSizing: 'border-box',
            flexShrink: 0,
            zIndex: 30,
          }}
          aria-label="微信标签栏"
        >
          {[
            { id: 'chats', label: '微信', icon: '💬', badge: totalUnread },
            { id: 'contacts', label: '通讯录', icon: '👥', badge: 0 },
            { id: 'discover', label: '发现', icon: '🧭', badge: 0 }, // -1 代表纯红点
            { id: 'me', label: '我', icon: '👤', badge: 0 },
          ].map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  playTapSound();
                  setTab(item.id as typeof tab);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '2px',
                  cursor: 'pointer',
                  position: 'relative',
                  padding: '4px 14px',
                  color: active ? '#07c160' : '#71717a',
                }}
              >
                <div style={{ position: 'relative', fontSize: '20px', lineHeight: 1 }}>
                  <span>{item.icon}</span>
                  {item.badge > 0 && (
                    <span
                      style={{
                        position: 'absolute',
                        top: '-4px',
                        right: '-8px',
                        background: '#ef4444',
                        color: '#ffffff',
                        fontSize: '10px',
                        fontWeight: 700,
                        borderRadius: '10px',
                        padding: '1px 4px',
                        lineHeight: 1,
                      }}
                    >
                      {item.badge}
                    </span>
                  )}
                  {item.badge === -1 && (
                    <span
                      style={{
                        position: 'absolute',
                        top: '-2px',
                        right: '-4px',
                        width: '7px',
                        height: '7px',
                        borderRadius: '50%',
                        background: '#ef4444',
                      }}
                    />
                  )}
                </div>
                <span style={{ fontSize: '10px', fontWeight: active ? 600 : 400 }}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* 联系人名片 Sheet 弹层 */}
        {selectedProfile && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(15, 23, 42, 0.5)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              zIndex: 100,
            }}
            onClick={() => setSelectedProfileId(null)}
          >
            <div
              style={{
                background: '#ffffff',
                borderTopLeftRadius: '20px',
                borderTopRightRadius: '20px',
                padding: '24px 20px',
                boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                maxHeight: '82%',
                overflowY: 'auto',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <PersonCard contact={selectedProfile} onClose={() => setSelectedProfileId(null)} />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <button
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '11px',
                    borderRadius: '12px',
                    background: '#07c160',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '14px',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    const id = selectedProfile.id;
                    setSelectedProfileId(null);
                    open('messages', id);
                  }}
                >
                  💬 发送微信
                </button>
                <button
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '11px',
                    borderRadius: '12px',
                    background: '#f1f5f9',
                    color: '#1e293b',
                    border: '1px solid #cbd5e1',
                    fontWeight: 600,
                    fontSize: '14px',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setCallingContact(selectedProfile);
                  }}
                >
                  📞 拨打电话
                </button>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    padding: '9px',
                    borderRadius: '10px',
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    fontSize: '12px',
                    color: '#475569',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setSelectedProfileId(null);
                    open('calendar');
                  }}
                >
                  🗓️ 查看日程
                </button>
                <button
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    padding: '9px',
                    borderRadius: '10px',
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    fontSize: '12px',
                    color: '#475569',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setSelectedProfileId(null);
                    open('photos');
                  }}
                >
                  🖼️ 查看相册
                </button>
              </div>
            </div>
          </div>
        )}
        {callingContact && (
          <CallModal
            contact={callingContact}
            onClose={() => setCallingContact(null)}
            onOpenChat={(id) => {
              setCallingContact(null);
              setSelectedProfileId(null);
              open('messages', id);
            }}
          />
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // 微信单聊对话视图
  // -------------------------------------------------------------------------
  const disabled =
    (operation?.busy && !operation?.canInterrupt) ||
    (operation?.status === 'accepted' && operation.signature === text) ||
    hasInFlightLocalSend(messages);
  const relatedInvitation = findRelatedInvitation(data.invitations, actor.id, data.referenceTime);
  const invitationOperation = relatedInvitation
    ? operations[`chat-invite:${relatedInvitation.id}`]
    : undefined;
  const invitationBlocked = !actions.changeInvitation || Boolean(invitationOperation?.busy);
  const invitationDue = relatedInvitation
    ? Date.parse(relatedInvitation.at) <= Date.parse(data.referenceTime ?? '')
    : false;
  const invitationMap = relatedInvitation?.links?.find((link) => link.app === 'map');
  const invitationStatusLabel: Record<string, string> = {
    proposed: '待回复',
    confirmed: '已约好',
    attended: '已赴约',
    cancelled: '已取消',
    missed: '未赴约',
  };
  async function respondToInvitation(kind: 'accept' | 'cancel') {
    if (!relatedInvitation || !actions.changeInvitation || invitationBlocked) return;
    const invitation = relatedInvitation;
    const receipt = await run(
      `chat-invite:${invitation.id}`,
      `${invitation.version}:${kind}`,
      (commandId) =>
        actions.changeInvitation!({
          id: invitation.id,
          operation: kind,
          expectedVersion: invitation.version,
          commandId,
        }),
    );
    if (receipt?.status === 'committed') {
      setAppointmentConfirm(false);
      setAppointmentNotice(
        kind === 'accept' ? '已接受，日程里现在能看到这次约定。' : '已拒绝这次邀约，日程已取消。',
      );
    }
  }

  return (
    <div
      className={`${s.app} ${s.chat}`}
      data-phone-thread
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#ebebeb',
        position: 'relative',
      }}
    >
      {/* 顶部单栏原生微信导航 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#ededed',
          borderBottom: '1px solid #dcdcdc',
          padding: '6px 12px',
          minHeight: '44px',
          boxSizing: 'border-box',
          position: 'sticky',
          top: 0,
          zIndex: 20,
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => {
            playTapSound();
            open('messages');
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            background: 'none',
            border: 'none',
            color: '#181818',
            fontSize: '15px',
            fontWeight: 500,
            cursor: 'pointer',
            padding: '4px 6px',
            borderRadius: '6px',
          }}
          aria-label="返回微信"
        >
          <span style={{ fontSize: '18px', lineHeight: 1 }}>‹</span>
          <span>微信{totalUnread > 0 ? ` (${totalUnread})` : ''}</span>
        </button>

        <button
          type="button"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            minWidth: 0,
            flex: 1,
            border: 'none',
            background: 'none',
            padding: '4px',
            minHeight: '44px',
          }}
          onClick={() => setShowPerson(true)}
          title="查看好友资料"
          aria-label={`查看${actor.name}的人物资料`}
        >
          <span
            style={{
              fontSize: '16px',
              fontWeight: 600,
              color: '#111827',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              maxWidth: '100%',
            }}
          >
            <span
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {actor.name}
            </span>
          </span>
          <span
            style={{
              fontSize: '11px',
              color: '#64748b',
              marginTop: '1px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span>查看人物资料</span>
          </span>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            aria-label={`查看${actor.name}的朋友圈`}
            style={{
              background: 'none',
              border: 'none',
              color: '#526782',
              fontSize: '12px',
              cursor: 'pointer',
              minHeight: '44px',
              padding: '4px',
            }}
            onClick={() => {
              setShowPerson(false);
              open('moments', actor.id);
            }}
          >
            TA的朋友圈
          </button>
          <button
            type="button"
            title={`拨打电话给 ${actor.name}`}
            style={{
              background: '#e2fbe8',
              border: '1px solid #bbf7d0',
              borderRadius: '50%',
              width: '30px',
              height: '30px',
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#15803d',
            }}
            onClick={(e) => {
              e.stopPropagation();
              setCallingContact(actor);
            }}
          >
            📞
          </button>
          <button
            type="button"
            style={{
              background: 'none',
              border: 'none',
              color: '#475569',
              fontSize: '20px',
              cursor: 'pointer',
              padding: '2px 4px',
              lineHeight: 1,
            }}
            onClick={() => setShowPerson(true)}
            title="更多与好友资料"
            aria-label={`更多：查看${actor.name}的好友资料`}
          >
            ···
          </button>
        </div>
      </div>

      {/* 人物名片遮罩 Sheet */}
      {showPerson && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.4)',
            zIndex: 40,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
          }}
          onClick={() => setShowPerson(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderTopLeftRadius: '16px',
              borderTopRightRadius: '16px',
              padding: '20px',
              boxShadow: '0 -4px 20px rgba(0,0,0,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <PersonCard contact={actor} onClose={() => setShowPerson(false)} />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => {
                  setShowPerson(false);
                  setCallingContact(actor);
                }}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '10px',
                  background: '#f1f5f9',
                  color: '#1e293b',
                  fontSize: '13px',
                  fontWeight: 600,
                  border: '1px solid #e2e8f0',
                  cursor: 'pointer',
                }}
              >
                📞 拨打电话
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowPerson(false);
                  open('photos');
                }}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '10px',
                  background: '#f1f5f9',
                  color: '#1e293b',
                  fontSize: '13px',
                  fontWeight: 600,
                  border: '1px solid #e2e8f0',
                  cursor: 'pointer',
                }}
              >
                🖼️ 查看相册
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 消息滚动流 */}
      <div
        ref={messageScroll}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (!el.clientHeight) return;
          lastScroll.current = el.scrollTop;
          wasNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          setDraft(`scroll:${target}`, String(el.scrollTop));
        }}
        className={s.messages}
        style={{
          background: '#ebebeb',
          padding: '12px 10px',
          flex: 1,
          overflowY: 'auto',
        }}
        role="log"
        aria-label={`与${actor.name}的聊天`}
        aria-live="polite"
        aria-relevant="additions"
      >
        {relatedInvitation && (
          <section className={s.chatInvitation} aria-label="聊天里的日程邀约">
            <header>
              <small>日程邀约 · {timeText(relatedInvitation.at)}</small>
              <span className={s.chatInvitationStatus}>
                {invitationStatusLabel[relatedInvitation.status] ?? '日程'}
              </span>
            </header>
            <h3>{relatedInvitation.title}</h3>
            <p>
              {invitationMap
                ? `地点：${invitationMap.label || '约定地点'}`
                : relatedInvitation.status === 'proposed'
                  ? '还没有替你答应。接受、改期或拒绝都由你决定。'
                  : '时间以这段人生的日程为准。'}
            </p>
            <Feedback operation={invitationOperation} success="日程已更新" />
            {appointmentNotice && (
              <p role="status" style={{ color: '#15803d' }}>
                {appointmentNotice}
              </p>
            )}
            {relatedInvitation.status === 'proposed' ? (
              <div className={s.chatInvitationActions}>
                <button
                  type="button"
                  className={s.chatInvitationPrimary}
                  disabled={invitationBlocked}
                  onClick={() => {
                    playTapSound();
                    void respondToInvitation('accept');
                  }}
                >
                  {invitationOperation?.errorCode === 'UNKNOWN' &&
                  invitationOperation.signature?.includes(':accept:')
                    ? '确认重试接受'
                    : '接受'}
                </button>
                <button
                  type="button"
                  disabled={invitationBlocked}
                  onClick={() => {
                    playTapSound();
                    setAppointmentConfirm(false);
                    open('calendar', relatedInvitation.id);
                  }}
                >
                  改期
                </button>
                {appointmentConfirm ? (
                  <button
                    type="button"
                    className={s.chatInvitationDanger}
                    disabled={invitationBlocked}
                    onClick={() => {
                      playTapSound();
                      void respondToInvitation('cancel');
                    }}
                  >
                    确认拒绝
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={invitationBlocked}
                    onClick={() => {
                      playTapSound();
                      setAppointmentConfirm(true);
                    }}
                  >
                    拒绝
                  </button>
                )}
              </div>
            ) : (
              <div className={s.chatInvitationActions}>
                {invitationMap && (
                  <button
                    type="button"
                    className={s.chatInvitationPrimary}
                    onClick={() => {
                      playTapSound();
                      open('map', invitationMap.target);
                    }}
                  >
                    前往{invitationMap.label || '约定地点'}
                  </button>
                )}
                {invitationDue && actions.enterScene && (
                  <button
                    type="button"
                    disabled={invitationBlocked}
                    onClick={() => {
                      playTapSound();
                      void run(`chat-scene:${relatedInvitation.id}`, relatedInvitation.id, () =>
                        actions.enterScene!(relatedInvitation.id),
                      );
                    }}
                  >
                    进入现场
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    playTapSound();
                    open('calendar', relatedInvitation.id);
                  }}
                >
                  查看日程
                </button>
              </div>
            )}
          </section>
        )}
        {!messages.length && <Empty title="还没有聊天记录" text={`和${actor.name}说句话吧。`} />}
        {messages.map((m) => (
          <article
            key={m.id}
            className={`${s.message} ${m.role === 'user' ? s.mine : ''}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              margin: '6px 0',
            }}
          >
            <time
              style={{
                alignSelf: 'center',
                fontSize: '11px',
                color: '#94a3b8',
                marginBottom: '6px',
                background: 'rgba(0,0,0,0.04)',
                padding: '2px 8px',
                borderRadius: '10px',
              }}
            >
              {formatChatTime(m.at, data.referenceTime)}
            </time>
            <div
              style={{
                display: 'flex',
                flexDirection: m.role === 'user' ? 'row-reverse' : 'row',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '0 4px',
              }}
            >
              {m.role === 'user' ? (
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '4px',
                    background: '#07c160',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 600,
                    fontSize: '14px',
                    flexShrink: 0,
                  }}
                >
                  我
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowPerson(true)}
                  aria-label={`查看${actor.name}的好友资料`}
                  className={profile.messageAvatar}
                  style={{ flexShrink: 0 }}
                >
                  <Avatar
                    url={actor.avatarUrl}
                    name={actor.name}
                    kind={actor.avatarKind}
                    label={actor.avatarLabel}
                  />
                </button>
              )}
              <div
                style={{
                  maxWidth: '74%',
                  padding: m.photo?.url && !m.text ? 0 : '9px 12px',
                  borderRadius: '4px',
                  fontSize: '14px',
                  lineHeight: '1.5',
                  wordBreak: 'break-word',
                  background:
                    m.photo?.url && !m.text
                      ? 'transparent'
                      : m.role === 'user'
                        ? '#95ec69'
                        : '#ffffff',
                  color: '#0f172a',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                  border:
                    m.photo?.url && !m.text
                      ? 'none'
                      : m.role === 'user'
                        ? '1px solid #82d857'
                        : '1px solid #dcdcdc',
                  position: 'relative',
                }}
              >
                {m.role === 'assistant' && m.initialRead === true && (
                  <small className={s.genesisOrigin}>虚构起点来信</small>
                )}
                {(() => {
                  const sticker = m.stickerId
                    ? parseStickerText(`[[sticker:${m.stickerId}]]`)
                    : m.text
                      ? parseStickerText(m.text)
                      : null;
                  return sticker ? (
                    <img
                      src={sticker.src}
                      alt={sticker.label}
                      style={{ display: 'block', width: 96, height: 96, objectFit: 'contain' }}
                    />
                  ) : (
                    m.text && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{m.text}</p>
                  );
                })()}
                {m.photo && m.photo.status === 'failed' && (
                  <div
                    style={{
                      marginTop: '8px',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      background: '#fef2f2',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '12px' }}>⚠️</span>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#b91c1c' }}>
                        {m.photo.title || '画面记录未完成'}
                      </span>
                    </div>
                    <span style={{ fontSize: '11px', color: '#ef4444' }}>
                      {m.photo.description || '生成未成功或已取消'}
                    </span>
                  </div>
                )}
                {m.attachment && (
                  <div
                    style={{
                      marginTop: m.text ? 8 : 0,
                      maxWidth: 250,
                      borderRadius: 7,
                      overflow: 'hidden',
                    }}
                  >
                    {m.attachment.kind === 'image' ? (
                      <button
                        type="button"
                        style={{
                          display: 'block',
                          border: 0,
                          padding: 0,
                          background: 'transparent',
                          cursor: 'pointer',
                        }}
                        aria-label={`查看${m.attachment.label || '历史聊天图片'}`}
                        onClick={() =>
                          setPreviewModalPhoto({
                            id: m.attachment!.assetId,
                            date: m.at,
                            title: m.attachment!.label || '历史聊天图片',
                            description: '这段关系中的历史聊天图片',
                            url: m.attachment!.url,
                            status: 'ready',
                            tag: 'memory',
                          })
                        }
                      >
                        <img
                          src={m.attachment.url}
                          alt={m.attachment.label || '历史聊天图片'}
                          style={{
                            display: 'block',
                            width: '100%',
                            maxHeight: 260,
                            objectFit: 'contain',
                          }}
                        />
                      </button>
                    ) : (
                      <video
                        src={m.attachment.url}
                        controls
                        playsInline
                        preload="metadata"
                        aria-label={m.attachment.label || '历史聊天视频'}
                        style={{
                          display: 'block',
                          width: '100%',
                          maxHeight: 300,
                          background: '#111827',
                        }}
                      >
                        当前浏览器无法播放这段视频。
                      </video>
                    )}
                    {m.attachment.label && (
                      <small
                        style={{ display: 'block', padding: '4px 2px', overflowWrap: 'anywhere' }}
                      >
                        {m.attachment.label}
                      </small>
                    )}
                  </div>
                )}
                {m.photo &&
                  (m.photo.status === 'ready' || !m.photo.status) &&
                  m.photo.url &&
                  (m.photo.mediaType === 'video' || m.photo.mimeType === 'video/mp4' ? (
                    <video
                      src={m.photo.url}
                      controls
                      playsInline
                      preload="metadata"
                      aria-label="收到的视频"
                      style={{
                        display: 'block',
                        width: '100%',
                        maxWidth: 250,
                        maxHeight: 300,
                        borderRadius: 7,
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      aria-label="查看图片"
                      onClick={() => {
                        playTapSound();
                        setPreviewModalPhoto(m.photo!);
                      }}
                      style={{
                        display: 'block',
                        padding: 0,
                        border: 0,
                        background: 'transparent',
                        cursor: 'pointer',
                        borderRadius: 7,
                        overflow: 'hidden',
                      }}
                    >
                      <img
                        src={m.photo.url}
                        alt="收到的图片"
                        style={{
                          display: 'block',
                          width: '100%',
                          maxWidth: 250,
                          maxHeight: 300,
                          objectFit: 'contain',
                        }}
                      />
                    </button>
                  ))}
                <Links links={m.links} open={open} />
              </div>
            </div>
            {m.replyInterrupted && (
              <small
                style={{ alignSelf: 'flex-start', marginLeft: 48, color: '#64748b', fontSize: 12 }}
              >
                这次回复中途结束，已收到的消息已保存。
              </small>
            )}
            {m.status === 'pending' && (
              <small
                style={{
                  alignSelf: 'flex-end',
                  marginRight: '48px',
                  color: '#94a3b8',
                  fontSize: '10px',
                  marginTop: '2px',
                }}
              >
                ◌
              </small>
            )}
            {(m.status === 'failed' || m.status === 'unknown') && (
              <button
                type="button"
                className={s.messageFailure}
                aria-label={
                  m.status === 'unknown' ? '发送结果待确认，点按核对' : '发送失败，点按重试'
                }
                title={m.status === 'unknown' ? '发送结果待确认，点按核对' : '发送失败，点按重试'}
                disabled={!actions.retryMessage || operations[`retry:${m.id}`]?.busy}
                style={{
                  alignSelf: 'flex-end',
                  marginRight: '48px',
                  marginTop: '2px',
                  background: 'none',
                  border: 'none',
                  color: '#ef4444',
                  fontSize: '18px',
                  lineHeight: 1,
                  cursor: 'pointer',
                }}
                onClick={() => {
                  if (
                    m.status === 'unknown' &&
                    !window.confirm(
                      '先核对上次是否已经发送。核对不会重新生成回复；原消息会继续保留，你也可以先继续聊天。',
                    )
                  )
                    return;
                  void run(`retry:${m.id}`, m.id, async (id) => {
                    const signature = hasLocalSendFailure(operation, [m], operations)
                      ? operation?.signature
                      : m.text;
                    const receipt = await actions.retryMessage!(
                      m.id,
                      m.status === 'unknown' ? m.id : id,
                    );
                    if (receipt.status === 'committed' && draftsRef.current[key] === signature)
                      setDraft(key, '');
                    return receipt;
                  });
                }}
              >
                ❗
              </button>
            )}
          </article>
        ))}
        {operation?.busy && (
          <div className={s.typingBubble} aria-live="polite">
            <span>{actor.name}正在输入</span>
            <i />
            <i />
            <i />
          </div>
        )}
      </div>

      {/* 原生微信底栏输入区域 */}
      <form
        className={s.composer}
        style={{
          background: '#f7f7f7',
          borderTop: '1px solid #dfdfdf',
          padding: '8px 10px',
          flexShrink: 0,
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          const value = text.trim();
          if (!value || !actions.sendMessage || disabled) return;
          playSendSound();
          setDraft(key, '');
          await run(key, text, (id, updateOp) =>
            actions.sendMessage!(actor.id, value, id, undefined, updateOp),
          );
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: '8px',
            overflowX: 'auto',
            padding: '0 0 6px 0',
            scrollbarWidth: 'none',
          }}
          aria-label="快速发起互动"
        >
          {['在忙吗？', '关于接下来的安排…', '有空碰个面吗？', '刚看到便签里的事…'].map((topic) => (
            <button
              key={topic}
              type="button"
              style={{
                flexShrink: 0,
                fontSize: '11px',
                padding: '3px 8px',
                borderRadius: '12px',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                color: '#475569',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              onClick={() => {
                playTapSound();
                setDraft(key, topic);
              }}
            >
              💬 {topic}
            </button>
          ))}
        </div>

        <div
          className={s.composerRow}
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <textarea
            id={`compose-${actor.id}`}
            aria-label={`给${actor.name}发消息`}
            rows={1}
            maxLength={4000}
            value={text}
            onChange={(e) => setDraft(key, e.target.value)}
            placeholder={actions.sendMessage ? '发消息…' : '聊天尚未接通，可先写草稿'}
            style={{
              flex: 1,
              minHeight: '36px',
              maxHeight: '80px',
              borderRadius: '6px',
              padding: '8px 10px',
              fontSize: '14px',
              border: '1px solid #d1d5db',
              background: '#ffffff',
              resize: 'none',
            }}
            onFocus={() => {
              setShowPlusMenu(false);
              setShowEmojiKeyboard(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />

          {/* 3. 表情图标键 */}
          <button
            type="button"
            title="表情"
            style={{
              background: 'none',
              border: 'none',
              fontSize: '22px',
              cursor: 'pointer',
              padding: '2px',
              color: showEmojiKeyboard ? '#07c160' : '#334155',
              flexShrink: 0,
            }}
            onClick={() => {
              playTapSound();
              setShowEmojiKeyboard((v) => !v);
              setShowPlusMenu(false);
            }}
          >
            😊
          </button>

          {/* 4. 加号键 / 绿色发送键 */}
          {text.trim() ? (
            <button
              className={s.green}
              type="submit"
              disabled={!actions.sendMessage || disabled}
              style={{
                borderRadius: '6px',
                padding: '6px 12px',
                height: '36px',
                fontSize: '14px',
                fontWeight: 600,
                background: '#07c160',
                color: '#ffffff',
                border: 'none',
                flexShrink: 0,
                cursor: 'pointer',
              }}
            >
              发送
            </button>
          ) : (
            <button
              type="button"
              title="更多功能"
              style={{
                background: 'none',
                border: '1px solid #94a3b8',
                borderRadius: '50%',
                width: '30px',
                height: '30px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '20px',
                cursor: 'pointer',
                color: showPlusMenu ? '#07c160' : '#475569',
                flexShrink: 0,
                lineHeight: 1,
              }}
              onClick={() => {
                playTapSound();
                setShowPlusMenu((v) => !v);
                setShowEmojiKeyboard(false);
              }}
            >
              +
            </button>
          )}
        </div>

        {/* 表情键盘面板 */}
        {showEmojiKeyboard && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(8, 1fr)',
              gap: '6px',
              padding: '12px 6px 6px',
              borderTop: '1px solid #e5e7eb',
              marginTop: '8px',
              maxHeight: '130px',
              overflowY: 'auto',
            }}
          >
            {EMOJI_LIST.map((emoji) => (
              <button
                key={emoji}
                type="button"
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '22px',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onClick={() => {
                  playTapSound();
                  setDraft(key, text + emoji);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        {/* 原生微信 8 宫格加号扩展面板 */}
        {showPlusMenu && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '12px',
              padding: '14px 8px 6px',
              borderTop: '1px solid #e5e7eb',
              marginTop: '8px',
            }}
          >
            {[
              {
                icon: '🖼️',
                label: '相册',
                action: () => {
                  setShowPlusMenu(false);
                  setShowPhotoPicker(true);
                },
              },
              {
                icon: '📷',
                label: '拍摄',
                action: () => {
                  setShowPlusMenu(false);
                  open('photos');
                },
              },
              {
                icon: '📞',
                label: '语音通话',
                action: () => {
                  setShowPlusMenu(false);
                  setCallingContact(actor);
                },
              },
              {
                icon: '📍',
                label: '位置',
                action: () => {
                  setShowPlusMenu(false);
                  setDraft(key, '📍 [位置分享] 我的当前位置（忙完随时联系我～）');
                },
              },
              {
                icon: '🧧',
                label: '红包',
                action: () => {
                  setShowPlusMenu(false);
                  setDraft(key, '🧧 [微信红包] 恭喜发财，大吉大利！');
                },
              },
              {
                icon: '👤',
                label: '名片',
                action: () => {
                  setShowPlusMenu(false);
                  setShowPerson(true);
                },
              },
              {
                icon: '🗓️',
                label: '约定',
                action: () => {
                  setShowPlusMenu(false);
                  open('calendar');
                },
              },
              {
                icon: '📝',
                label: '便签',
                action: () => {
                  setShowPlusMenu(false);
                  open('notes');
                },
              },
            ].map((btn) => (
              <button
                key={btn.label}
                type="button"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  playTapSound();
                  btn.action();
                }}
              >
                <div
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '12px',
                    background: '#ffffff',
                    border: '1px solid #d1d5db',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '22px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  }}
                >
                  {btn.icon}
                </div>
                <span style={{ fontSize: '11px', color: '#475569' }}>{btn.label}</span>
              </button>
            ))}
          </div>
        )}

        {!localFailure && (
          <Feedback operation={operation} pending="发送并等待对方回复…" success="消息已发送" />
        )}
      </form>

      {callingContact && (
        <CallModal
          contact={callingContact}
          onClose={() => setCallingContact(null)}
          onOpenChat={(id) => {
            setCallingContact(null);
            setSelectedProfileId(null);
            open('messages', id);
          }}
        />
      )}

      {showPhotoPicker && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
          }}
          onClick={() => setShowPhotoPicker(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderTopLeftRadius: '16px',
              borderTopRightRadius: '16px',
              padding: '16px',
              maxHeight: '70%',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 -4px 20px rgba(0,0,0,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '12px',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>
                选择照片分享给 {actor.name}
              </h3>
              <button
                type="button"
                onClick={() => setShowPhotoPicker(false)}
                style={{
                  border: 'none',
                  background: 'none',
                  fontSize: '18px',
                  color: '#64748b',
                  cursor: 'pointer',
                  padding: '4px',
                }}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '8px',
                paddingBottom: '12px',
              }}
            >
              {data.photos.length === 0 ? (
                <div
                  style={{
                    gridColumn: 'span 3',
                    textAlign: 'center',
                    padding: '24px 0',
                    color: '#94a3b8',
                  }}
                >
                  相册中暂无照片
                </div>
              ) : (
                data.photos.map((photo) => (
                  <div
                    key={photo.id}
                    style={{
                      borderRadius: '8px',
                      overflow: 'hidden',
                      border: '1px solid #e2e8f0',
                      background: '#f8fafc',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                    onClick={async () => {
                      if (disabled) return;
                      playSendSound();
                      setShowPhotoPicker(false);
                      const shareText = `[分享了相册照片：《${photo.title}》]`;
                      if (actions.sendMessage) {
                        // Use an isolated operation key so user's typed draft in message input box is preserved
                        await run(`share-photo:${actor.id}`, shareText, (id) =>
                          actions.sendMessage!(actor.id, shareText, id, photo),
                        );
                      }
                    }}
                  >
                    <div style={{ height: '76px', position: 'relative' }}>
                      <img
                        src={photo.url || '/art/first-window.webp'}
                        alt={photo.title}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          top: '3px',
                          left: '3px',
                          fontSize: '8px',
                          background: photo.title.includes('【身份写真】')
                            ? 'rgba(245, 158, 11, 0.9)'
                            : 'rgba(99, 102, 241, 0.9)',
                          color: '#ffffff',
                          padding: '1px 3px',
                          borderRadius: '3px',
                        }}
                      >
                        {photo.title.includes('【身份写真】') ? '🌟写真' : '📸剧照'}
                      </div>
                    </div>
                    <span
                      style={{
                        padding: '4px',
                        fontSize: '10.5px',
                        color: '#334155',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {photo.title}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div
              style={{
                display: 'flex',
                gap: '8px',
                paddingTop: '8px',
                borderTop: '1px solid #f1f5f9',
              }}
            >
              <button
                type="button"
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '10px',
                  border: '1px solid #e2e8f0',
                  background: '#f8fafc',
                  color: '#475569',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
                onClick={() => {
                  setShowPhotoPicker(false);
                  open('photos');
                }}
              >
                前往相册完整浏览 →
              </button>
            </div>
          </div>
        </div>
      )}

      {previewModalPhoto && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            zIndex: 110,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '16px',
          }}
          onClick={() => setPreviewModalPhoto(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              maxWidth: '340px',
              width: '100%',
              overflow: 'hidden',
              boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: '300px',
                background: '#000000',
              }}
            >
              {previewModalPhoto.mediaType === 'video' ||
              previewModalPhoto.mimeType === 'video/mp4' ? (
                <video
                  src={previewModalPhoto.url}
                  preload="auto"
                  controls
                  playsInline
                  autoPlay
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              ) : (
                <img
                  src={previewModalPhoto.url}
                  alt={previewModalPhoto.title}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              )}
              <button
                type="button"
                onClick={() => setPreviewModalPhoto(null)}
                style={{
                  position: 'absolute',
                  top: '10px',
                  right: '10px',
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  background: 'rgba(0,0,0,0.5)',
                  color: '#ffffff',
                  border: 'none',
                  fontSize: '16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: '14px 16px' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}
              >
                <span
                  style={{
                    background:
                      previewModalPhoto.mediaType === 'video' ||
                      previewModalPhoto.mimeType === 'video/mp4'
                        ? '#fdf2f8'
                        : previewModalPhoto.title.includes('【身份写真】')
                          ? '#fef3c7'
                          : '#e0e7ff',
                    color:
                      previewModalPhoto.mediaType === 'video' ||
                      previewModalPhoto.mimeType === 'video/mp4'
                        ? '#be185d'
                        : previewModalPhoto.title.includes('【身份写真】')
                          ? '#b45309'
                          : '#4338ca',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 600,
                  }}
                >
                  {previewModalPhoto.mediaType === 'video' ||
                  previewModalPhoto.mimeType === 'video/mp4'
                    ? '🎥 关键片段'
                    : previewModalPhoto.title.includes('【身份写真】')
                      ? '🌟 身份写真'
                      : '📸 剧情事件解锁'}
                </span>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                  {dayKey(previewModalPhoto.date)}
                </span>
              </div>
              <h4 style={{ margin: '0 0 6px', fontSize: '15px', color: '#0f172a' }}>
                {previewModalPhoto.title}
              </h4>
              <p
                style={{
                  margin: '0 0 14px',
                  fontSize: '12.5px',
                  color: '#64748b',
                  lineHeight: 1.5,
                }}
              >
                {previewModalPhoto.description}
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    padding: '9px',
                    borderRadius: '8px',
                    background: '#07c160',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    playTapSound();
                    if (typeof window !== 'undefined' && previewModalPhoto.url) {
                      localStorage.setItem('phone_wallpaper', previewModalPhoto.url);
                    }
                    setPreviewModalPhoto(null);
                  }}
                >
                  设为手机壁纸
                </button>
                {data.photos.some((p) => p.id === previewModalPhoto.id) ? (
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      padding: '9px',
                      borderRadius: '8px',
                      background: '#f1f5f9',
                      color: '#334155',
                      border: '1px solid #cbd5e1',
                      fontWeight: 500,
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      setPreviewModalPhoto(null);
                      open('photos', previewModalPhoto.id);
                    }}
                  >
                    在相册中查看
                  </button>
                ) : (
                  <span
                    style={{
                      flex: 1,
                      padding: '9px',
                      textAlign: 'center',
                      fontSize: '11px',
                      color: '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    💬 聊天专属附件
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CallModal({
  contact,
  onClose,
  onOpenChat,
}: {
  contact: PhoneContact;
  onClose: () => void;
  onOpenChat: (actorId: string) => void;
}) {
  return (
    <div className={s.inviteOverlay} onClick={onClose}>
      <section
        className={s.inviteSheet}
        role="dialog"
        aria-modal="true"
        aria-label="语音通话"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h3>{contact.name}</h3>
          <button autoFocus onClick={onClose}>
            关闭
          </button>
        </header>
        <p>语音通话尚未接通。现在可以发消息和对方交流。</p>
        <button
          className={s.primary}
          onClick={() => {
            onClose();
            onOpenChat(contact.id);
          }}
        >
          发消息
        </button>
      </section>
    </div>
  );
}
