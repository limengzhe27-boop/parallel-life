import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PhoneAppContext } from '../phone-shell.tsx';
import type { PhoneContact, PhonePhoto } from './types.ts';
import { usePhoneApps } from './provider.tsx';
import { Avatar, Empty, Feedback, Links, Search } from './common.tsx';
import { formatChatTime, searchable, timeText } from './helpers.ts';
import { playSendSound, playTapSound } from '../audio-feedback.ts';
import s from './apps.module.css';

const EMOJI_LIST = [
  '😊', '😂', '🤣', '❤️', '👍', '🙏', '🎉', '✨',
  '🔥', '👏', '🥳', '😎', '🤔', '👀', '💡', '☕',
  '🍻', '🍰', '🌸', '☀️', '🌙', '⭐', '🎈', '🤝',
  '💪', '💯', '🚀', '💌', '💼', '📍', '🕒', '🆗',
];

export function MessagesApp({ target, open }: PhoneAppContext) {
  const { data, actions, drafts, setDraft, operations, run } = usePhoneApps();
  const [tab, setTab] = useState<'chats' | 'contacts' | 'discover' | 'me'>('chats');
  const [query, setQuery] = useState('');
  const [showPerson, setShowPerson] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [callNotice, setCallNotice] = useState<string | null>(null);
  const [callingContact, setCallingContact] = useState<PhoneContact | null>(null);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [showEmojiKeyboard, setShowEmojiKeyboard] = useState(false);
  const [showDropdownMenu, setShowDropdownMenu] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);
  const [previewModalPhoto, setPreviewModalPhoto] = useState<PhonePhoto | null>(null);

  const messageScroll = useRef<HTMLDivElement>(null);
  const wasNearBottom = useRef(true);
  const lastScroll = useRef(0);
  const readAttempt = useRef<string | undefined>(undefined);

  const actor = data.contacts.find((c) => c.id === target);
  const messages = data.messages
    .filter((m) => m.actorId === target)
    .sort((a, b) => a.at.localeCompare(b.at));
  const key = `message:${target}`,
    text = drafts[key] ?? '',
    operation = operations[key];

  const totalUnread = data.contacts.reduce((sum, c) => sum + (c.unread || 0), 0);

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
  }, [target]);

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

  if (target && !actor) return <Empty title="找不到这个联系人" text="请返回通讯录或刷新后再试。" />;

  // -------------------------------------------------------------------------
  // 微信主页视图（4-Tab 模式）
  // -------------------------------------------------------------------------
  if (!actor) {
    const contacts = data.contacts.filter((c) => searchable(query, c.name, c.relationship));
    const sortedChats = [...contacts].sort((a, b) => {
      const latestA = data.messages
        .filter((m) => m.actorId === a.id)
        .sort((x, y) => x.at.localeCompare(y.at))
        .at(-1);
      const latestB = data.messages
        .filter((m) => m.actorId === b.id)
        .sort((x, y) => x.at.localeCompare(y.at))
        .at(-1);
      const timeA = latestA?.at ?? '';
      const timeB = latestB?.at ?? '';
      return timeB.localeCompare(timeA);
    });
    const selectedProfile = data.contacts.find((c) => c.id === selectedProfileId);

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
          <div style={{ fontSize: '17px', fontWeight: 600, color: '#111827' }}>
            {getTitle()}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <button
              type="button"
              title="搜索"
              aria-label="搜索"
              onClick={() => {
                const el = document.getElementById('wechat-search-input');
                el?.focus();
              }}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '16px',
                color: '#1f2937',
                cursor: 'pointer',
                padding: '4px',
              }}
            >
              🔍
            </button>
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
                { icon: '💬', label: '发起群聊', action: () => open('messages') },
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
                <Search
                  label="搜索"
                  value={query}
                  onChange={setQuery}
                />
              </div>
              <div className={s.list} style={{ padding: 0 }}>
                {sortedChats.map((c) => {
                  const latest = data.messages
                    .filter((m) => m.actorId === c.id)
                    .sort((a, b) => a.at.localeCompare(b.at))
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
                        <Avatar url={c.avatarUrl} name={c.name} />
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
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                          {latest?.text ?? '开始聊聊'}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </div>
              {!contacts.length && (
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
                <Search
                  label="搜索联系人"
                  value={query}
                  onChange={setQuery}
                />
              </div>

              <div style={{ padding: '6px 16px', fontSize: '12px', color: '#6b7280', background: '#f8fafc' }}>
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
                    <Avatar url={c.avatarUrl} name={c.name} />
                    <span className={s.contactText} style={{ flex: 1 }}>
                      <strong style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '15px' }}>
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
                        {c.summary ? (c.summary.length > 26 ? c.summary.slice(0, 26) + '…' : c.summary) : '查看名片与生平'}
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
                  <div style={{ fontSize: '18px', fontWeight: 600, color: '#111827' }}>
                    我
                  </div>
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
            { id: 'discover', label: '发现', icon: '🧭', badge: -1 }, // -1 代表纯红点
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                  <Avatar url={selectedProfile.avatarUrl} name={selectedProfile.name} />
                  <div>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#0f172a' }}>
                      {selectedProfile.name}
                    </h3>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px' }}>
                      <span
                        style={{
                          fontSize: '12px',
                          background: '#f1f5f9',
                          color: '#334155',
                          padding: '2px 8px',
                          borderRadius: '8px',
                          fontWeight: 500,
                        }}
                      >
                        {selectedProfile.relationship}
                      </span>
                      <span style={{ fontSize: '11px', color: '#16a34a' }}>● 在线</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedProfileId(null)}
                  style={{
                    background: '#f1f5f9',
                    border: 'none',
                    borderRadius: '50%',
                    width: '28px',
                    height: '28px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    color: '#64748b',
                  }}
                  aria-label="关闭名片"
                >
                  ✕
                </button>
              </div>

              <div
                style={{
                  background: '#f8fafc',
                  borderRadius: '12px',
                  padding: '12px 14px',
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px', fontWeight: 600 }}>
                  人物生平与性格
                </div>
                <div style={{ fontSize: '13px', color: '#334155', lineHeight: 1.6 }}>
                  {selectedProfile.summary || `在当前人生中与你相识，是你的${selectedProfile.relationship}。`}
                </div>
              </div>

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
                  🖼️ 共同回忆
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
    operation?.busy || (operation?.status === 'accepted' && operation.signature === text);
  const relatedInvitation =
    data.invitations.find((inv) => inv.participantIds.includes(actor.id)) ?? null;

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

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            maxWidth: '180px',
          }}
          onClick={() => setShowPerson((v) => !v)}
          title="点击查看人物名片"
        >
          <div style={{ fontSize: '16px', fontWeight: 600, color: '#111827', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>{actor.name}</span>
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '1px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>{actor.relationship || '朋友'}</span>
            <span>·</span>
            <span style={{ color: '#16a34a' }}>● 在线</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
            onClick={() => setShowPerson((v) => !v)}
            title="更多与名片"
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Avatar url={actor.avatarUrl} name={actor.name} />
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>{actor.name}</h3>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>{actor.relationship || '朋友'}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPerson(false)}
                style={{ background: 'none', border: 'none', fontSize: '18px', color: '#94a3b8', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#475569', lineHeight: 1.6 }}>
              {actor.summary ?? `在当前人生世界中与你紧密相连的${actor.relationship || '重要人物'}。`}
            </p>
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
                🖼️ 查看共同回忆
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
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              margin: '4px 0 10px',
            }}
          >
            <span
              onClick={() => open('calendar', relatedInvitation.id)}
              style={{
                background: 'rgba(0, 0, 0, 0.06)',
                color: '#64748b',
                fontSize: '11px',
                padding: '4px 10px',
                borderRadius: '12px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
              role="button"
              tabIndex={0}
              aria-label="查看相关日程"
            >
              🗓️ 约定：{relatedInvitation.title} · {relatedInvitation.status === 'confirmed' ? '已约好' : '待回复'} ›
            </span>
          </div>
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
                <div style={{ flexShrink: 0 }}>
                  <Avatar url={actor.avatarUrl} name={actor.name} />
                </div>
              )}
              <div
                style={{
                  maxWidth: '74%',
                  padding: '9px 12px',
                  borderRadius: '4px',
                  fontSize: '14px',
                  lineHeight: '1.5',
                  wordBreak: 'break-word',
                  background: m.role === 'user' ? '#95ec69' : '#ffffff',
                  color: '#0f172a',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                  border: m.role === 'user' ? '1px solid #82d857' : '1px solid #dcdcdc',
                  position: 'relative',
                }}
              >
                <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{m.text}</p>
                {m.photo && (
                  <div
                    style={{
                      marginTop: '8px',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      border: '1px solid rgba(0,0,0,0.08)',
                      background: '#f8fafc',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      playTapSound();
                      setPreviewModalPhoto(m.photo!);
                    }}
                  >
                    <div style={{ position: 'relative' }}>
                      <img
                        src={m.photo.url || '/art/first-window.webp'}
                        alt={m.photo.title}
                        style={{ width: '100%', maxHeight: '180px', objectFit: 'cover', display: 'block' }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          top: '6px',
                          left: '6px',
                          background: 'rgba(0,0,0,0.65)',
                          color: '#ffffff',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '10px',
                          fontWeight: 600,
                        }}
                      >
                        📸 剧情事件照片
                      </div>
                    </div>
                    <div
                      style={{
                        padding: '6px 8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: '#f8fafc',
                      }}
                    >
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#1e293b' }}>
                        {m.photo.title}
                      </span>
                      <span style={{ fontSize: '11px', color: '#0284c7' }}>
                        查看大图 ›
                      </span>
                    </div>
                  </div>
                )}
                <Links links={m.links} open={open} />
              </div>
            </div>
            {m.status === 'pending' && (
              <small style={{ alignSelf: 'flex-end', marginRight: '48px', color: '#94a3b8', fontSize: '10px', marginTop: '2px' }}>
                发送中…
              </small>
            )}
            {(m.status === 'failed' || m.status === 'unknown') && (
              <div className={s.messageFailure} style={{ alignSelf: 'flex-end', marginRight: '48px', marginTop: '2px' }}>
                <span>{m.status === 'unknown' ? '待确认' : '发送失败'}</span>
                <button
                  disabled={
                    !actions.retryMessage ||
                    operations[`retry:${m.id}`]?.busy ||
                    operations[`retry:${m.id}`]?.status === 'accepted'
                  }
                  onClick={() =>
                    void run(`retry:${m.id}`, m.id, (id) => actions.retryMessage!(m.id, id))
                  }
                >
                  {m.status === 'unknown' ? '确认重试' : '重试'}
                </button>
                <Feedback operation={operations[`retry:${m.id}`]} success="重试已完成" />
              </div>
            )}
          </article>
        ))}
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
          await run(key, text, (id) => actions.sendMessage!(actor.id, value, id));
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

        <div className={s.composerRow} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* 1. 语音切换键 */}
          <button
            type="button"
            title={isVoiceMode ? '切换键盘' : '切换语音'}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '22px',
              cursor: 'pointer',
              padding: '2px',
              color: '#334155',
              flexShrink: 0,
            }}
            onClick={() => {
              playTapSound();
              setIsVoiceMode((v) => !v);
              setShowPlusMenu(false);
              setShowEmojiKeyboard(false);
            }}
          >
            {isVoiceMode ? '⌨️' : '🎙️'}
          </button>

          {/* 2. 中间输入框 / 按住说话 */}
          {isVoiceMode ? (
            <button
              type="button"
              style={{
                flex: 1,
                height: '38px',
                borderRadius: '6px',
                background: '#ffffff',
                border: '1px solid #d1d5db',
                fontSize: '14px',
                fontWeight: 600,
                color: '#374151',
                cursor: 'pointer',
              }}
              onClick={() => {
                playTapSound();
                setDraft(key, '🎙️ [语音消息 6"] 刚听完你的消息，我这会儿手头正好处理完，晚点跟你碰面细聊！');
                setIsVoiceMode(false);
              }}
            >
              按住 说话（点击发送模拟语音）
            </button>
          ) : (
            <textarea
              id={`compose-${actor.id}`}
              rows={1}
              maxLength={4000}
              value={text}
              disabled={!!operation?.busy}
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
          )}

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
              setIsVoiceMode(false);
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
                setIsVoiceMode(false);
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
                  setDraft(
                    key,
                    '📍 [位置分享] 我的当前位置（忙完随时联系我～）',
                  );
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

        <Feedback operation={operation} success="消息已提交" />
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
                <div style={{ gridColumn: 'span 3', textAlign: 'center', padding: '24px 0', color: '#94a3b8' }}>
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
                      playSendSound();
                      setShowPhotoPicker(false);
                      const shareText = `[分享了相册照片：《${photo.title}》]`;
                      setDraft(key, shareText);
                      if (actions.sendMessage) {
                        await run(key, shareText, (id) => actions.sendMessage!(actor.id, shareText, id));
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
                          background: photo.title.includes('【身份写真】') ? 'rgba(245, 158, 11, 0.9)' : 'rgba(99, 102, 241, 0.9)',
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

            <div style={{ display: 'flex', gap: '8px', paddingTop: '8px', borderTop: '1px solid #f1f5f9' }}>
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
            <div style={{ position: 'relative', width: '100%', height: '300px', background: '#000000' }}>
              <img
                src={previewModalPhoto.url || '/art/first-window.webp'}
                alt={previewModalPhoto.title}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <span
                  style={{
                    background: previewModalPhoto.title.includes('【身份写真】') ? '#fef3c7' : '#e0e7ff',
                    color: previewModalPhoto.title.includes('【身份写真】') ? '#b45309' : '#4338ca',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 600,
                  }}
                >
                  {previewModalPhoto.title.includes('【身份写真】') ? '🌟 身份写真' : '📸 剧情事件解锁'}
                </span>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                  {previewModalPhoto.date.slice(0, 10)}
                </span>
              </div>
              <h4 style={{ margin: '0 0 6px', fontSize: '15px', color: '#0f172a' }}>
                {previewModalPhoto.title}
              </h4>
              <p style={{ margin: '0 0 14px', fontSize: '12.5px', color: '#64748b', lineHeight: 1.5 }}>
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
                    if (typeof window !== 'undefined') {
                      localStorage.setItem('phone_wallpaper', previewModalPhoto.url || '/art/first-window.webp');
                    }
                    setPreviewModalPhoto(null);
                  }}
                >
                  设为手机壁纸
                </button>
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
  const [status, setStatus] = useState<'dialing' | 'connected' | 'ended'>('dialing');
  const [seconds, setSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(true);

  useEffect(() => {
    const dialTimer = setTimeout(() => {
      setStatus('connected');
    }, 2200);
    return () => clearTimeout(dialTimer);
  }, []);

  useEffect(() => {
    if (status !== 'connected') return;
    const interval = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

  const voiceLine = useMemo(() => {
    const rel = contact.relationship || '';
    if (
      rel.includes('合伙') ||
      rel.includes('创') ||
      rel.includes('同事') ||
      rel.includes('工作') ||
      rel.includes('项目')
    ) {
      return `“喂！刚看你打来。这会儿手头正在推进事务，稍后我把重点发你微信，咱们文字对一下更细致，有事随时找我！”`;
    }
    if (
      rel.includes('师') ||
      rel.includes('长') ||
      rel.includes('领导') ||
      rel.includes('前辈') ||
      rel.includes('顾问')
    ) {
      return `“喂，我正准备参加一个研讨会议，你先在微信把想法留言给我，我一散会马上看。”`;
    }
    if (rel.includes('友') || rel.includes('学') || rel.includes('闺蜜') || rel.includes('哥们')) {
      return `“喂～怎么啦！我正赶路呢，刚想着给你发消息你就打过来了！晚点微信聊，随时找我哈！”`;
    }
    return `“喂？我刚看到你打过来，手头正忙着一小会儿，晚点微信上细聊，记得看我消息哦！”`;
  }, [contact]);

  const handleEndCall = () => {
    setStatus('ended');
    setTimeout(() => {
      onClose();
    }, 1200);
  };

  const formatCallDuration = (sec: number) => {
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'linear-gradient(180deg, #090d16 0%, #0f172a 60%, #1e1b4b 100%)',
        color: '#ffffff',
        zIndex: 120,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '60px 24px 44px 24px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11px',
            color: '#94a3b8',
            letterSpacing: '0.05em',
          }}
        >
          <span>🔒</span> 端到端加密通话
        </div>
        <div style={{ fontSize: '24px', fontWeight: 700, color: '#f8fafc', marginTop: '6px' }}>
          {contact.name}
        </div>
        <div
          style={{
            fontSize: '13px',
            color: '#cbd5e1',
            background: 'rgba(255,255,255,0.08)',
            padding: '2px 10px',
            borderRadius: '12px',
          }}
        >
          {contact.relationship}
        </div>
        <div
          style={{
            fontSize: '15px',
            color: status === 'connected' ? '#4ade80' : '#94a3b8',
            fontWeight: 500,
            marginTop: '4px',
          }}
        >
          {status === 'dialing' && '正在呼叫…'}
          {status === 'connected' && formatCallDuration(seconds)}
          {status === 'ended' && `通话已结束（时长 ${formatCallDuration(seconds)}）`}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '20px',
          maxWidth: '320px',
          width: '100%',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: '96px',
            height: '96px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.1)',
            boxShadow:
              status === 'dialing'
                ? '0 0 0 10px rgba(59, 130, 246, 0.2), 0 0 0 20px rgba(59, 130, 246, 0.1)'
                : '0 10px 25px rgba(0,0,0,0.5)',
            transition: 'box-shadow 0.4s ease',
          }}
        >
          <div
            style={{
              width: '84px',
              height: '84px',
              borderRadius: '50%',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#334155',
            }}
          >
            <Avatar url={contact.avatarUrl} name={contact.name} />
          </div>
        </div>

        {status === 'connected' && (
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.12)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.16)',
              borderRadius: '16px',
              padding: '14px 16px',
              color: '#f1f5f9',
              fontSize: '13px',
              lineHeight: 1.6,
              textAlign: 'center',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                color: '#93c5fd',
                marginBottom: '4px',
                fontWeight: 600,
              }}
            >
              🎙️ 对方实时语音中
            </div>
            {voiceLine}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '28px',
          width: '100%',
          maxWidth: '300px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-around', width: '100%' }}>
          <button
            type="button"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
              background: isMuted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255,255,255,0.1)',
              border: isMuted ? '1px solid #ef4444' : '1px solid rgba(255,255,255,0.15)',
              borderRadius: '50%',
              width: '56px',
              height: '56px',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#ffffff',
              fontSize: '18px',
            }}
            onClick={() => setIsMuted((m) => !m)}
          >
            {isMuted ? '🔇' : '🎤'}
          </button>

          <button
            type="button"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
              background: isSpeaker ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255,255,255,0.1)',
              border: isSpeaker ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.15)',
              borderRadius: '50%',
              width: '56px',
              height: '56px',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#ffffff',
              fontSize: '18px',
            }}
            onClick={() => setIsSpeaker((s) => !s)}
          >
            {isSpeaker ? '🔊' : '🔈'}
          </button>

          <button
            type="button"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '50%',
              width: '56px',
              height: '56px',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#ffffff',
              fontSize: '18px',
            }}
            onClick={() => onOpenChat(contact.id)}
          >
            💬
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button
            type="button"
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: '#ef4444',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontSize: '26px',
              cursor: 'pointer',
              transform: 'rotate(135deg)',
              boxShadow: '0 4px 15px rgba(239, 68, 68, 0.4)',
            }}
            onClick={handleEndCall}
            aria-label="挂断电话"
          >
            📞
          </button>
        </div>
      </div>
    </div>
  );
}
