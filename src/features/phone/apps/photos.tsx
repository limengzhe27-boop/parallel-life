import { useRef, useState } from 'react';
import type { PhoneAppContext } from '../phone-shell.tsx';
import type { PhonePhoto } from './types.ts';
import { usePhoneApps } from './provider.tsx';
import { Empty, Feedback, Links } from './common.tsx';
import { dayKey } from './helpers.ts';
import s from './apps.module.css';
const labels = {
  queued: '等待生成',
  generating: '正在生成',
  ready: '照片暂不可用',
  failed: '生成失败',
  unknown: '生成结果待确认',
};
function PhotoImage({ photo, detail = false }: { photo: PhonePhoto; detail?: boolean }) {
  const [failed, setFailed] = useState(false);
  return photo.status === 'ready' && photo.url && !failed ? (
    <img
      className={detail ? s.fullPhoto : s.thumbnail}
      src={photo.url}
      alt={photo.description || photo.title}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  ) : (
    <div className={detail ? s.photoPlaceholder : s.thumbnailPlaceholder}>
      <span aria-hidden>▧</span>
      <p>{failed ? '照片加载失败' : labels[photo.status]}</p>
    </div>
  );
}
function UploadPhoto() {
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
    <div className={s.inline}>
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
        disabled={operation?.busy}
        onClick={() => input.current?.click()}
      >
        {operation?.busy ? '正在保存照片…' : '添加照片'}
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
  const { data, actions, operations, run } = usePhoneApps();
  const photos = [...data.photos].sort((a, b) => b.date.localeCompare(a.date));
  const photo = photos.find((p) => p.id === target);
  if (target && !photo)
    return <Empty title="找不到这张照片" text="照片可能已移除，请返回相册或刷新。" />;
  if (photo) {
    const index = photos.findIndex((p) => p.id === photo.id);
    return (
      <div className={`${s.app} ${s.photoDetail}`}>
        <div className={s.photoHeading}>
          <time>{dayKey(photo.date)}</time>
          <h3>{photo.title}</h3>
        </div>
        <PhotoImage key={`${photo.id}:${photo.url}`} photo={photo} detail />
        <p className={s.photoDescription}>{photo.description}</p>
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
              {!actions.retryPhoto && <small>照片生成尚未接入</small>}
            </>
          )}
          <Feedback
            operation={operations[`photo:${photo.id}`]}
            success="重试已完成，请查看照片状态"
          />
          <Links links={photo.links} open={open} />
        </div>
        <div className={s.photoNav}>
          <button disabled={index === 0} onClick={() => open('photos', photos[index - 1]!.id)}>
            上一张
          </button>
          <span>
            {index + 1} / {photos.length}
          </span>
          <button
            disabled={index === photos.length - 1}
            onClick={() => open('photos', photos[index + 1]!.id)}
          >
            下一张
          </button>
        </div>
      </div>
    );
  }
  const days = [...new Set(photos.map((p) => dayKey(p.date)))];
  return (
    <div className={s.app}>
      <div className={s.sectionHeading}>
        <h3>照片图库</h3>
        <small>{photos.length} 项</small>
      </div>
      <UploadPhoto />
      {!photos.length && (
        <div style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', margin: '8px 12px' }}>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#f5d580' }}>🎞️ 人生记忆胶卷</h4>
          <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#999', lineHeight: 1.5 }}>
            新生活刚刚拉开序幕，过去的节点留在了胶卷里。你也可以点击上方上传一张新照片。
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
            <div style={{ borderRadius: '8px', overflow: 'hidden', background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.1)' }}>
              <img src="/art/first-window.webp" alt="窗前" style={{ width: '100%', height: '110px', objectFit: 'cover' }} />
              <div style={{ padding: '6px 8px' }}>
                <strong style={{ fontSize: '12px', display: 'block', color: '#eee' }}>最初的窗口</strong>
                <small style={{ fontSize: '10px', color: '#888' }}>搬进新居的第一天</small>
              </div>
            </div>
            <div style={{ borderRadius: '8px', overflow: 'hidden', background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.1)' }}>
              <img src="/art/open-door.webp" alt="门前" style={{ width: '100%', height: '110px', objectFit: 'cover' }} />
              <div style={{ padding: '6px 8px' }}>
                <strong style={{ fontSize: '12px', display: 'block', color: '#eee' }}>推开门那一刻</strong>
                <small style={{ fontSize: '10px', color: '#888' }}>做出选择后的清晨</small>
              </div>
            </div>
          </div>
        </div>
      )}
      {days.map((day) => (
        <section key={day} className={s.photoGroup}>
          <h3>{day || '日期未知'}</h3>
          <div className={s.photoGrid}>
            {photos
              .filter((p) => dayKey(p.date) === day)
              .map((p) => (
                <button
                  key={p.id}
                  className={s.photoTile}
                  aria-label={`${p.title}，${p.status === 'ready' ? '查看照片' : labels[p.status]}`}
                  onClick={() => open('photos', p.id)}
                >
                  <PhotoImage photo={p} />
                  <span>{p.title}</span>
                </button>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
