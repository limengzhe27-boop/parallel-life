import { useMemo, useRef, useState } from 'react';
import type { PhoneAppContext } from '../phone-shell.tsx';
import type { PhonePhoto } from './types.ts';
import { usePhoneApps } from './provider.tsx';
import { Empty, Feedback, Links } from './common.tsx';
import { dayKey } from './helpers.ts';
import { playTapSound } from '../audio-feedback.ts';
import s from './apps.module.css';
const labels = {
  queued: '等待生成',
  generating: '正在生成',
  ready: '照片暂不可用',
  failed: '生成失败',
  unknown: '生成结果待确认',
};
function PhotoImage({ photo, detail = false }: { photo: PhonePhoto; detail?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const failed = !!photo.url && failedUrl === photo.url;
  return photo.status === 'ready' && photo.url && !failed ? (
    <img
      className={detail ? s.fullPhoto : s.thumbnail}
      src={photo.url}
      alt={photo.description || photo.title}
      onError={() => setFailedUrl(photo.url)}
      loading="lazy"
    />
  ) : (
    <div className={detail ? s.photoPlaceholder : s.thumbnailPlaceholder}>
      <span aria-hidden>▧</span>
      <p>{failed ? '照片加载失败' : labels[photo.status]}</p>
      {failed && detail && <button onClick={() => setFailedUrl(undefined)}>重新加载照片</button>}
    </div>
  );
}
function UploadPhoto({
  label,
  style,
  className,
}: {
  label?: string;
  style?: React.CSSProperties;
  className?: string;
}) {
  const { actions, operations, run } = usePhoneApps();
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<{ file: File; signature: string } | null>(null);
  const [error, setError] = useState('');
  const operation = operations['album-upload'];
  async function upload(selection: { file: File; signature: string }) {
    const receipt = await run('album-upload', selection.signature, (commandId) =>
      actions.uploadPhoto!(selection.file, commandId),
    );
    if (receipt?.status === 'committed') setSelected(null);
  }
  if (!actions.uploadPhoto) return null;
  return (
    <div className={className || s.inline}>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="选择相册照片"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file || operation?.busy) return;
          setError('');
          if (
            !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
            file.size > 4 * 1024 * 1024 ||
            file.size === 0
          ) {
            setError('请选择 4MB 以内的 JPG、PNG 或 WebP 图片。');
            return;
          }
          const selection = { file, signature: crypto.randomUUID() };
          setSelected(selection);
          void upload(selection);
        }}
      />
      <button
        className={s.primary}
        style={style}
        disabled={operation?.busy}
        onClick={() => input.current?.click()}
      >
        {operation?.busy ? '正在保存照片…' : (label ?? '添加照片')}
      </button>
      {selected && operation?.status === 'failed' && operation.errorCode !== 'INVALID_INPUT' && (
        <button onClick={() => void upload(selected)}>重试上传</button>
      )}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      <Feedback
        operation={
          operation?.errorCode === 'INVALID_INPUT'
            ? {
                ...operation,
                error: '无法读取这张图片，请重新选择 JPG、PNG 或 WebP 图片（不超过 4MB）。',
              }
            : operation
        }
        success="已存入相册"
      />
    </div>
  );
}
export function PhotosApp({ target, open }: PhoneAppContext) {
  const { data, actions, operations, run, setDraft } = usePhoneApps();
  const [selectedActorFilter, setSelectedActorFilter] = useState<string>('all');

  const [wallpaperNotice, setWallpaperNotice] = useState('');
  const [shareActorId, setShareActorId] = useState('');
  const lifeMemories = data.photos;

  const [selectedCategory, setSelectedCategory] = useState<'all' | 'identity' | 'event' | 'memory'>(
    'all',
  );

  const filteredPhotos = useMemo(() => {
    let result = lifeMemories;
    if (selectedCategory === 'identity' || selectedCategory === 'event') {
      result = result.filter((p) => p.tag === selectedCategory);
    } else if (selectedCategory === 'memory') {
      result = result.filter((p) => p.tag === 'upload' || p.tag === 'memory');
    }
    if (selectedActorFilter !== 'all') {
      const actor = data.contacts.find((c) => c.id === selectedActorFilter);
      if (actor) {
        result = result.filter((p) =>
          p.sourcePersonId
            ? p.sourcePersonId === actor.sourcePersonId
            : p.description.includes(actor.name) || p.title.includes(actor.name),
        );
      }
    }
    return result;
  }, [lifeMemories, selectedCategory, selectedActorFilter, data.contacts]);

  const photo = lifeMemories.find((p) => p.id === target);

  if (target && !photo)
    return <Empty title="找不到这张照片" text="照片可能已移除，请返回相册或刷新。" />;

  if (photo) {
    const index = lifeMemories.findIndex((p) => p.id === photo.id);
    const relatedContact = data.contacts.find((c) => c.id === shareActorId);

    return (
      <div className={`${s.app} ${s.photoDetail}`}>
        {/* 顶部 iOS 原生相册返回导航 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: '1px solid #f1f5f9',
            background: '#ffffff',
            minHeight: '44px',
            margin: '-12px -12px 12px -12px',
          }}
        >
          <button
            type="button"
            onClick={() => {
              playTapSound();
              open('photos');
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              background: 'none',
              border: 'none',
              color: '#0284c7',
              fontSize: '15px',
              fontWeight: 500,
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            <span style={{ fontSize: '18px', lineHeight: 1 }}>‹</span>
            <span>图库</span>
          </button>
          <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
            {index + 1} / {lifeMemories.length}
          </span>
          <div style={{ width: '40px' }} />
        </div>
        <div className={s.photoHeading}>
          <time>
            {photo.sourcePersonId ? '上传于 ' : ''}
            {dayKey(photo.date)}
          </time>
          <h3>{photo.title}</h3>
        </div>
        <PhotoImage key={`${photo.id}:${photo.url}`} photo={photo} detail />

        <div
          style={{
            background: '#f8fafc',
            padding: '14px 16px',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            margin: '8px 0',
          }}
        >
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, marginBottom: '6px' }}>
            照片来源
          </div>
          <p
            className={s.photoDescription}
            style={{ margin: 0, fontSize: '13.5px', lineHeight: 1.7, color: '#334155' }}
          >
            {photo.description}
          </p>
        </div>

        {/* 底部前后翻页与设为壁纸操作 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            margin: '8px 0',
          }}
        >
          <button
            type="button"
            disabled={index <= 0}
            onClick={() => {
              playTapSound();
              const prev = lifeMemories[index - 1];
              if (prev) open('photos', prev.id);
            }}
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              fontSize: '13px',
              cursor: index <= 0 ? 'not-allowed' : 'pointer',
              opacity: index <= 0 ? 0.4 : 1,
            }}
          >
            ‹ 上一张
          </button>

          {photo.url && actions.setWallpaper && (
            <button
              type="button"
              onClick={() => {
                playTapSound();
                actions.setWallpaper!(photo.url!);
                setWallpaperNotice('已设为这部手机的壁纸');
              }}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                background: '#f1f5f9',
                color: '#0f172a',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              🖼️ 设为手机壁纸
            </button>
          )}

          <button
            type="button"
            disabled={index >= lifeMemories.length - 1}
            onClick={() => {
              playTapSound();
              const next = lifeMemories[index + 1];
              if (next) open('photos', next.id);
            }}
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              fontSize: '13px',
              cursor: index >= lifeMemories.length - 1 ? 'not-allowed' : 'pointer',
              opacity: index >= lifeMemories.length - 1 ? 0.4 : 1,
            }}
          >
            下一张 ›
          </button>
        </div>

        {wallpaperNotice && <p role="status">{wallpaperNotice}</p>}
        <div className={s.inline}>
          {(photo.status === 'failed' || photo.status === 'unknown') && (
            <>
              <p>
                {photo.status === 'unknown'
                  ? '上次生成结果尚未确认。请先刷新核对，确认重试可能再次发起生成。'
                  : '这张照片没能生成，可以再试一次。'}
              </p>
              <button
                className={s.primary}
                disabled={
                  !actions.retryPhoto ||
                  operations[`photo:${photo.id}`]?.busy ||
                  operations[`photo:${photo.id}`]?.status === 'accepted'
                }
                onClick={() =>
                  void run(`photo:${photo.id}`, photo.id, (id) => actions.retryPhoto!(photo.id, id))
                }
              >
                {photo.status === 'unknown' ? '确认重试生成' : '重新生成'}
              </button>
            </>
          )}
          <Feedback
            operation={operations[`photo:${photo.id}`]}
            success="重试已完成，请查看照片状态"
          />
        </div>

        {data.contacts.length > 0 && (
          <div style={{ marginTop: '8px' }}>
            <select
              aria-label="选择聊照片的人"
              value={shareActorId}
              onChange={(event) => setShareActorId(event.target.value)}
            >
              <option value="">选择联系人</option>
              {data.contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!relatedContact}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '12px',
                background: '#07c160',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                fontSize: '14px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                boxShadow: '0 2px 8px rgba(7,193,96,0.2)',
              }}
              onClick={() => {
                if (!relatedContact) return;
                const topic = `想和你聊聊相册里的《${photo.title}》。`;
                setDraft(`message:${relatedContact.id}`, topic);
                open('messages', relatedContact.id);
              }}
            >
              {relatedContact ? `和${relatedContact.name}聊这张照片` : '先选择联系人'}
            </button>
          </div>
        )}
      </div>
    );
  }

  const days = [...new Set(filteredPhotos.map((p) => dayKey(p.date)))];

  return (
    <div
      className={s.app}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#ffffff' }}
    >
      {/* 顶部 iOS 原生图库导航栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid #f1f5f9',
          background: '#ffffff',
          minHeight: '44px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 700, margin: 0, color: '#0f172a' }}>图库</h2>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            全部照片 · {filteredPhotos.length} 张回忆
          </span>
        </div>
        <UploadPhoto />
      </div>

      {/* 照片分类分栏（身份写真 / 剧情事件 / 生活回忆） */}
      <div
        style={{
          display: 'flex',
          gap: '6px',
          padding: '8px 12px 6px',
          background: '#ffffff',
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        {[
          { key: 'all', label: `全部 (${lifeMemories.length})`, icon: '🖼️' },
          {
            key: 'identity',
            label: `身份写真 (${lifeMemories.filter((p) => p.tag === 'identity').length})`,
            icon: '🌟',
          },
          {
            key: 'event',
            label: `剧情事件 (${lifeMemories.filter((p) => p.tag === 'event').length})`,
            icon: '🎬',
          },
          {
            key: 'memory',
            label: `生活回忆 (${lifeMemories.filter((p) => p.tag === 'upload' || p.tag === 'memory').length})`,
            icon: '📱',
          },
        ].map((tab) => {
          const active = selectedCategory === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSelectedCategory(tab.key as any)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 10px',
                borderRadius: '14px',
                border: active ? '1px solid #0284c7' : '1px solid #e2e8f0',
                background: active ? '#0284c7' : '#f8fafc',
                color: active ? '#ffffff' : '#475569',
                fontSize: '11.5px',
                fontWeight: active ? 600 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* 人物筛选胶囊（对齐 Screen 05） */}
      {data.contacts.length > 0 && (
        <div
          style={{
            margin: '4px 12px 10px',
            display: 'flex',
            gap: '8px',
            overflowX: 'auto',
            paddingBottom: '4px',
            scrollbarWidth: 'none',
          }}
        >
          <button
            type="button"
            onClick={() => setSelectedActorFilter('all')}
            style={{
              padding: '4px 10px',
              borderRadius: '14px',
              fontSize: '11px',
              fontWeight: 500,
              border: selectedActorFilter === 'all' ? '1px solid #0284c7' : '1px solid #e2e8f0',
              background: selectedActorFilter === 'all' ? '#e0f2fe' : '#ffffff',
              color: selectedActorFilter === 'all' ? '#0369a1' : '#475569',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            全部好友
          </button>
          {data.contacts.map((c) => {
            const count = lifeMemories.filter((p) =>
              p.sourcePersonId
                ? p.sourcePersonId === c.sourcePersonId
                : p.description.includes(c.name) || p.title.includes(c.name),
            ).length;
            const isSelected = selectedActorFilter === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedActorFilter(c.id)}
                style={{
                  padding: '4px 10px',
                  borderRadius: '14px',
                  fontSize: '11px',
                  fontWeight: 500,
                  border: isSelected ? '1px solid #0284c7' : '1px solid #e2e8f0',
                  background: isSelected ? '#e0f2fe' : '#ffffff',
                  color: isSelected ? '#0369a1' : '#475569',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.name} {count > 0 && `(${count})`}
              </button>
            );
          })}
        </div>
      )}

      {/* 生活胶卷网格 */}
      {filteredPhotos.length === 0 ? (
        <div
          style={{
            padding: '48px 20px',
            textAlign: 'center',
            color: '#64748b',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: '44px', marginBottom: '12px' }}>📷</div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', marginBottom: '6px' }}>
            {lifeMemories.length ? '没有符合筛选的照片' : '相册暂无照片'}
          </div>
          <div
            style={{
              fontSize: '13px',
              lineHeight: 1.6,
              color: '#64748b',
              maxWidth: '280px',
              margin: '0 auto 18px',
            }}
          >
            {lifeMemories.length ? '试试其他分类或人物。' : '上传一张照片，留在这段人生里。'}
          </div>
          <UploadPhoto
            label="➕ 上传生活照片"
            style={{
              padding: '9px 20px',
              fontSize: '13.5px',
              fontWeight: 600,
              borderRadius: '20px',
              boxShadow: '0 2px 8px rgba(2, 132, 199, 0.2)',
            }}
          />
        </div>
      ) : (
        <div style={{ padding: '0 12px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
            {filteredPhotos.map((p) => (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                aria-label={`查看照片：${p.title}`}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    open('photos', p.id);
                  }
                }}
                onClick={() => open('photos', p.id)}
                style={{
                  borderRadius: '12px',
                  overflow: 'hidden',
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div
                  style={{
                    width: '100%',
                    height: '118px',
                    overflow: 'hidden',
                    background: '#f1f5f9',
                    position: 'relative',
                  }}
                >
                  <PhotoImage photo={p} />
                  <div style={{ position: 'absolute', top: '6px', left: '6px' }}>
                    {p.tag === 'identity' ? (
                      <span
                        style={{
                          background: 'rgba(245, 158, 11, 0.92)',
                          color: '#ffffff',
                          padding: '1px 5px',
                          borderRadius: '4px',
                          fontSize: '9px',
                          fontWeight: 600,
                        }}
                      >
                        🌟 身份写真
                      </span>
                    ) : p.tag === 'event' ? (
                      <span
                        style={{
                          background: 'rgba(99, 102, 241, 0.92)',
                          color: '#ffffff',
                          padding: '1px 5px',
                          borderRadius: '4px',
                          fontSize: '9px',
                          fontWeight: 600,
                        }}
                      >
                        🎬 剧情事件
                      </span>
                    ) : (
                      <span
                        style={{
                          background: 'rgba(15, 23, 42, 0.65)',
                          color: '#ffffff',
                          padding: '1px 5px',
                          borderRadius: '4px',
                          fontSize: '9px',
                          fontWeight: 500,
                        }}
                      >
                        📱 上传照片
                      </span>
                    )}
                  </div>
                </div>
                <div
                  style={{
                    padding: '8px 10px',
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <strong style={{ fontSize: '13px', color: '#0f172a', display: 'block' }}>
                      {p.title}
                    </strong>
                    <p
                      style={{
                        fontSize: '11px',
                        color: '#64748b',
                        margin: '3px 0 0',
                        lineHeight: 1.4,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {p.description}
                    </p>
                  </div>
                  <div style={{ marginTop: '6px', fontSize: '10px', color: '#94a3b8' }}>
                    {p.sourcePersonId ? '上传于 ' : ''}
                    {dayKey(p.date)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
