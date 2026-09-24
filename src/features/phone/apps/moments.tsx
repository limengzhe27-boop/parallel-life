'use client';

import { useMemo, useState } from 'react';
import type { PhoneAppContext } from '../phone-shell.tsx';
import { usePhoneApps } from './provider.tsx';
import { Avatar } from './common.tsx';
import { playTapSound } from '../audio-feedback.ts';
import s from './apps.module.css';

export type MomentComment = {
  id: string;
  authorName: string;
  text: string;
  replyTo?: string;
};

export type MomentPost = {
  id: string;
  authorId: string;
  authorName: string;
  roleTitle?: string;
  content: string;
  timeLabel: string;
  mediaLabel?: string;
  mediaType?: 'photo' | 'location' | 'article';
  likes: string[];
  comments: MomentComment[];
};

export function MomentsApp({ open }: PhoneAppContext) {
  const { data } = usePhoneApps();
  const leadActor = data.contacts[0];
  const partnerActor =
    data.contacts.find((c) => c.relationship?.includes('合伙') || c.relationship?.includes('同事')) ??
    data.contacts[1];
  const elderActor =
    data.contacts.find((c) => c.relationship?.includes('师') || c.relationship?.includes('长')) ??
    data.contacts[2];
  const friendActor =
    data.contacts.find((c) => c.relationship?.includes('友') || c.relationship?.includes('学')) ??
    data.contacts[3];

  const initialPosts: MomentPost[] = useMemo(() => {
    if (!data.contacts.length) return [];
    const firstActor = data.contacts[0];
    const secondActor = data.contacts[1];
    const thirdActor = data.contacts[2];
    const topNote = data.notes[0];
    const topPhoto = data.photos[0];

    const result: MomentPost[] = [];

    if (firstActor) {
      result.push({
        id: `post-${firstActor.id}`,
        authorId: firstActor.id,
        authorName: firstActor.name,
        roleTitle: firstActor.relationship,
        content: firstActor.summary
          ? `${firstActor.summary}。新的一天，继续推进。`
          : `记录一下近况：一步步按计划进行，期待接下来的新阶段。✨`,
        timeLabel: '2小时前',
        mediaLabel: topPhoto ? `🖼️ ${topPhoto.title}` : undefined,
        mediaType: topPhoto ? 'photo' : undefined,
        likes: ['我', secondActor?.name].filter(Boolean) as string[],
        comments: secondActor
          ? [
              {
                id: 'c-1',
                authorName: secondActor.name,
                text: '大家一起加油！💪',
              },
            ]
          : [],
      });
    }

    if (secondActor) {
      result.push({
        id: `post-${secondActor.id}`,
        authorId: secondActor.id,
        authorName: secondActor.name,
        roleTitle: secondActor.relationship,
        content: secondActor.summary
          ? `${secondActor.summary}。和大家合作总是充满动力！`
          : `忙碌而充实的日常，保持专注与热爱。🌿`,
        timeLabel: '昨天 17:20',
        likes: ['我', firstActor?.name].filter(Boolean) as string[],
        comments: [],
      });
    }

    if (thirdActor) {
      result.push({
        id: `post-${thirdActor.id}`,
        authorId: thirdActor.id,
        authorName: thirdActor.name,
        roleTitle: thirdActor.relationship,
        content: thirdActor.summary
          ? `${thirdActor.summary}`
          : `今天天气不错，顺路忙完手头的事，准备开启新的安排。📷`,
        timeLabel: '3天前',
        likes: ['我', firstActor?.name].filter(Boolean) as string[],
        comments: [],
      });
    }

    if (topNote) {
      result.push({
        id: 'post-self',
        authorId: 'self',
        authorName: '我',
        roleTitle: '我的动态',
        content: topNote.text.slice(0, 140),
        timeLabel: '4天前',
        mediaLabel: `📝 ${topNote.title}`,
        mediaType: 'article',
        likes: [firstActor?.name, secondActor?.name].filter(Boolean) as string[],
        comments: [],
      });
    }

    return result;
  }, [data.contacts, data.notes, data.photos]);

  const storageKey = `pl_moments_posts_${data.contacts[0]?.id || 'default'}`;

  const [posts, setPosts] = useState<MomentPost[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Ignore
    }
    return initialPosts;
  });

  const [commentingPostId, setCommentingPostId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [newPostContent, setNewPostContent] = useState('');

  const savePosts = (next: MomentPost[]) => {
    setPosts(next);
    try {
      localStorage.setItem('pl_moments_posts', JSON.stringify(next));
    } catch {
      // Ignore
    }
  };

  const handleToggleLike = (postId: string) => {
    playTapSound();
    const next = posts.map((p) => {
      if (p.id !== postId) return p;
      const hasLiked = p.likes.includes('我');
      return {
        ...p,
        likes: hasLiked ? p.likes.filter((name) => name !== '我') : ['我', ...p.likes],
      };
    });
    savePosts(next);
  };

  const handleAddComment = (postId: string) => {
    if (!commentText.trim()) return;
    playTapSound();
    const newComment: MomentComment = {
      id: `c-${Date.now()}`,
      authorName: '我',
      text: commentText.trim(),
    };
    const next = posts.map((p) => {
      if (p.id !== postId) return p;
      return {
        ...p,
        comments: [...p.comments, newComment],
      };
    });
    savePosts(next);
    setCommentText('');
    setCommentingPostId(null);
  };

  const handlePublishPost = () => {
    if (!newPostContent.trim()) return;
    const newPost: MomentPost = {
      id: `post-${Date.now()}`,
      authorId: 'self',
      authorName: '我',
      roleTitle: '我的动态',
      content: newPostContent.trim(),
      timeLabel: '刚刚',
      likes: [],
      comments: [],
    };
    savePosts([newPost, ...posts]);
    setNewPostContent('');
    setShowCompose(false);
  };

  return (
    <div
      className={s.app}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%',
        background: '#ffffff',
      }}
    >
      {/* 朋友圈原生沉浸顶栏 */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          height: '44px',
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(16px)',
          borderBottom: '1px solid #f1f5f9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
        }}
      >
        <button
          type="button"
          onClick={() => open('messages')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            background: 'none',
            border: 'none',
            color: '#0f172a',
            fontSize: '15px',
            fontWeight: 500,
            cursor: 'pointer',
            padding: '4px 6px',
          }}
        >
          <span style={{ fontSize: '18px', lineHeight: 1 }}>‹</span> 微信
        </button>

        <span style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>朋友圈</span>

        <button
          type="button"
          onClick={() => setShowCompose(true)}
          title="发朋友圈"
          style={{
            background: 'none',
            border: 'none',
            fontSize: '18px',
            cursor: 'pointer',
            padding: '4px 8px',
          }}
        >
          📷
        </button>
      </div>

      {/* 朋友圈全景封面 */}
      <div style={{ position: 'relative', marginBottom: '32px' }}>
        <div
          style={{
            height: '180px',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)',
            position: 'relative',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'flex-start',
            padding: '16px',
            color: 'rgba(255,255,255,0.7)',
            fontSize: '12px',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              opacity: 0.15,
              backgroundImage:
                'radial-gradient(#ffffff 1px, transparent 1px), radial-gradient(#ffffff 1px, #0f172a 1px)',
              backgroundSize: '20px 20px',
              backgroundPosition: '0 0, 10px 10px',
            }}
          />
          <div style={{ position: 'relative', zIndex: 2 }}>
            <span style={{ letterSpacing: '0.05em' }}>📍 当前人生空间</span>
          </div>
        </div>

        {/* 主角头像与署名（右下角悬浮） */}
        <div
          style={{
            position: 'absolute',
            right: '16px',
            bottom: '-24px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#ffffff', textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
              我
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
              探索者
            </div>
          </div>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '14px',
              border: '2px solid #ffffff',
              background: 'linear-gradient(135deg, #0284c7, #0369a1)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '24px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            }}
          >
            我
          </div>
        </div>
      </div>

      {/* 发朋友圈弹窗 */}
      {showCompose && (
        <div
          style={{
            margin: '0 16px 20px',
            padding: '14px',
            background: '#f8fafc',
            borderRadius: '14px',
            border: '1px solid #e2e8f0',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', marginBottom: '8px' }}>
            📝 这一刻的想法
          </div>
          <textarea
            value={newPostContent}
            onChange={(e) => setNewPostContent(e.target.value)}
            placeholder="分享生活心境、施工进展或露台光影..."
            rows={3}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              boxSizing: 'border-box',
              resize: 'none',
              marginBottom: '10px',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              type="button"
              onClick={() => {
                setShowCompose(false);
                setNewPostContent('');
              }}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                fontSize: '12px',
                color: '#64748b',
                cursor: 'pointer',
              }}
            >
              取消
            </button>
            <button
              type="button"
              onClick={handlePublishPost}
              disabled={!newPostContent.trim()}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                background: '#07c160',
                border: 'none',
                fontSize: '12px',
                fontWeight: 600,
                color: '#ffffff',
                cursor: newPostContent.trim() ? 'pointer' : 'not-allowed',
                opacity: newPostContent.trim() ? 1 : 0.5,
              }}
            >
              发表
            </button>
          </div>
        </div>
      )}

      {/* 朋友圈动态流 */}
      <div style={{ padding: '0 16px 40px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {posts.map((post) => (
          <div
            key={post.id}
            style={{
              display: 'flex',
              gap: '12px',
              borderBottom: '1px solid #f1f5f9',
              paddingBottom: '20px',
            }}
          >
            {/* 头像 */}
            <div style={{ flexShrink: 0 }}>
              <Avatar name={post.authorName} />
            </div>

            {/* 内容主体 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#3b5998' }}>
                  {post.authorName}
                </span>
                {post.roleTitle && (
                  <span
                    style={{
                      fontSize: '10px',
                      background: '#f1f5f9',
                      color: '#64748b',
                      padding: '1px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    {post.roleTitle}
                  </span>
                )}
              </div>

              {/* 正文 */}
              <div
                style={{
                  fontSize: '14px',
                  color: '#1e293b',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  marginBottom: '8px',
                }}
              >
                {post.content}
              </div>

              {/* 附属媒体卡片 */}
              {post.mediaLabel && (
                <div
                  style={{
                    background: '#f8fafc',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    fontSize: '12px',
                    color: '#475569',
                    marginBottom: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  {post.mediaLabel}
                </div>
              )}

              {/* 时间与互动按钮 */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px',
                }}
              >
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>{post.timeLabel}</span>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => handleToggleLike(post.id)}
                    style={{
                      background: post.likes.includes('我') ? '#fef2f2' : '#f8fafc',
                      color: post.likes.includes('我') ? '#ef4444' : '#64748b',
                      border: '1px solid #e2e8f0',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    {post.likes.includes('我') ? '❤️ 已赞' : '🤍 赞'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setCommentingPostId(commentingPostId === post.id ? null : post.id)
                    }
                    style={{
                      background: '#f8fafc',
                      color: '#64748b',
                      border: '1px solid #e2e8f0',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    💬 评论
                  </button>
                </div>
              </div>

              {/* 评论输入框（展开时） */}
              {commentingPostId === post.id && (
                <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                  <input
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="说点什么..."
                    style={{
                      flex: 1,
                      padding: '6px 10px',
                      fontSize: '12px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddComment(post.id);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleAddComment(post.id)}
                    style={{
                      padding: '6px 12px',
                      background: '#07c160',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    发送
                  </button>
                </div>
              )}

              {/* 点赞与评论聚合区域 */}
              {(post.likes.length > 0 || post.comments.length > 0) && (
                <div
                  style={{
                    background: '#f8fafc',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    fontSize: '12px',
                    color: '#334155',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  {/* 点赞列表 */}
                  {post.likes.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#3b5998' }}>
                      <span>❤️</span>
                      <span style={{ fontWeight: 500 }}>{post.likes.join('、')}</span>
                    </div>
                  )}

                  {/* 评论列表 */}
                  {post.comments.length > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        borderTop: post.likes.length > 0 ? '1px solid #f1f5f9' : 'none',
                        paddingTop: post.likes.length > 0 ? '6px' : '0',
                      }}
                    >
                      {post.comments.map((comment) => (
                        <div key={comment.id} style={{ lineHeight: 1.4 }}>
                          <span style={{ color: '#3b5998', fontWeight: 600 }}>
                            {comment.authorName}
                            {comment.replyTo && (
                              <span style={{ color: '#64748b', fontWeight: 400 }}>
                                {' '}
                                回复{' '}
                                <span style={{ color: '#3b5998', fontWeight: 600 }}>
                                  {comment.replyTo}
                                </span>
                              </span>
                            )}
                            ：
                          </span>
                          <span style={{ color: '#1e293b' }}>{comment.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
