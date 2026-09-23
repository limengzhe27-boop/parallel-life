'use client';

import { useMemo, useState } from 'react';
import type { PhoneAppContext } from '../phone-shell.tsx';
import { usePhoneApps } from './provider.tsx';
import { Avatar } from './common.tsx';
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
    return [
      {
        id: 'post-1',
        authorId: leadActor?.id ?? 'lead',
        authorName: leadActor?.name ?? '沈棠',
        roleTitle: leadActor?.relationship ?? '策展人 · 伴侣',
        content:
          '老洋房开幕展布展 Day 3。南侧光庭在下午三点四十分的光线是最动人的。某人设计的采光天窗，确实把自然变成了最好的展品。初秋见。🍂',
        timeLabel: '1小时前',
        mediaLabel: '🖼️ 巨鹿路老洋房南光庭 · 采光天窗展陈（胶片预览）',
        mediaType: 'photo',
        likes: ['我', partnerActor?.name ?? '林见夏', elderActor?.name ?? '顾院长'],
        comments: [
          {
            id: 'c-1',
            authorName: partnerActor?.name ?? '林见夏',
            text: '南侧钢构件收口今天也全部验收完了，周末必须大吃一顿！🎉',
          },
          {
            id: 'c-2',
            authorName: '我',
            text: '采光角度是按夏至到秋分的日照轨迹测算过的，辛苦策展大师。☕',
          },
        ],
      },
      {
        id: 'post-2',
        authorId: partnerActor?.id ?? 'partner',
        authorName: partnerActor?.name ?? '林见夏',
        roleTitle: partnerActor?.relationship ?? '工作室合伙人',
        content:
          '第三批定制水刷石打样到场！经过六次调色配比，终于还原了老洋房1930年代的水刷石斑驳骨料质感。匠人师傅们辛苦了，我们离正式交付又近了一大步！💪',
        timeLabel: '昨天 17:20',
        mediaLabel: '📐 水刷石样块与施工收口节点图纸',
        mediaType: 'photo',
        likes: ['我', leadActor?.name ?? '沈棠', friendActor?.name ?? '周游'],
        comments: [
          {
            id: 'c-3',
            authorName: elderActor?.name ?? '顾院长',
            text: '材料肌理见真章，独立实践能沉下心磨骨料，很欣慰。',
          },
          {
            id: 'c-4',
            authorName: partnerActor?.name ?? '林见夏',
            replyTo: elderActor?.name ?? '顾院长',
            text: '谢谢院长鼓励！下周布展完毕请您来品茶指导！',
          },
        ],
      },
      {
        id: 'post-3',
        authorId: friendActor?.id ?? 'friend',
        authorName: friendActor?.name ?? '周游',
        roleTitle: friendActor?.relationship ?? '独立摄影师 · 好友',
        content:
          '巨鹿路初秋扫街。顺道去孟哲和见夏的工作室转了一圈，偷偷拍了两个人对着图纸抓耳挠腮的瞬间。胶片冲出来了，成片绝了。📷',
        timeLabel: '3天前',
        mediaLabel: '🎞️ 禄来双反胶片机试卷 · 老洋房侧影',
        mediaType: 'photo',
        likes: ['我', leadActor?.name ?? '沈棠'],
        comments: [
          {
            id: 'c-5',
            authorName: '我',
            text: '底片先给我审核，不帅的直接销毁哈哈。',
          },
          {
            id: 'c-6',
            authorName: friendActor?.name ?? '周游',
            text: '放心，特意给你加了建筑师专注光环！',
          },
        ],
      },
      {
        id: 'post-4',
        authorId: 'self',
        authorName: '我',
        roleTitle: '独立主创建筑师',
        content:
          '从图纸到实景，三年独立实践，巨鹿路768号终于迎来了它的第一个秋天。感谢所有同行的人。🍁',
        timeLabel: '4天前',
        mediaLabel: '📍 上海市静安区巨鹿路768号 · 老洋房工作室',
        mediaType: 'location',
        likes: [
          leadActor?.name ?? '沈棠',
          partnerActor?.name ?? '林见夏',
          elderActor?.name ?? '顾院长',
          friendActor?.name ?? '周游',
        ],
        comments: [
          {
            id: 'c-7',
            authorName: leadActor?.name ?? '沈棠',
            text: '一路看着你走过来，为你骄傲。❤️',
          },
        ],
      },
    ];
  }, [leadActor, partnerActor, elderActor, friendActor]);

  const [posts, setPosts] = useState<MomentPost[]>(() => {
    try {
      const saved = localStorage.getItem('pl_moments_posts');
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
      roleTitle: '独立主创建筑师',
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
            <span style={{ letterSpacing: '0.05em' }}>📍 上海静安 · 巨鹿路768号工作室</span>
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
              李孟哲
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
              主创建筑师
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
