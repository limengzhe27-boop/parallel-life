import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PhoneAppContext } from '../phone-shell.tsx';
import type { PhonePhoto } from './types.ts';
import { usePhoneApps } from './provider.tsx';
import { Feedback, Links } from './common.tsx';
import { readRoute, routeHash } from '../navigation.ts';
import { playTapSound } from '../audio-feedback.ts';
import {
  photoAlbums,
  photoDateLabel,
  photoDay,
  photoGroups,
  photoSourceLabel,
  photoTarget,
  readPhotoView,
  sortedPhotos,
} from './photo-library.ts';
import s from './photos.module.css';

// Ephemeral viewport positions only; no photos or world facts are cached here.
const viewportPositions = new Map<string, number>();
const labels = {
  queued: '等待生成',
  generating: '正在生成',
  ready: '照片暂不可用',
  failed: '生成失败',
  unknown: '结果待确认',
};
function Icon({
  name,
}: {
  name: 'grid' | 'albums' | 'back' | 'next' | 'info' | 'plus' | 'image' | 'close' | 'share';
}) {
  const paths = {
    grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    albums: 'M6 3h12 M4 6h16 M3 9h18v12H3z',
    back: 'M15 4l-8 8 8 8',
    next: 'M9 4l8 8-8 8',
    info: 'M12 10v7 M12 7h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    plus: 'M12 4v16 M4 12h16',
    image: 'M3 4h18v16H3z M3 17l6-6 4 4 3-3 5 5 M16 8h.01',
    close: 'M6 6l12 12 M6 18L18 6',
    share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8 M16 6l-4-4-4 4 M12 2v13',
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
function PhotoImage({
  photo,
  detail = false,
  onAvailable,
}: {
  photo: PhonePhoto;
  detail?: boolean;
  onAvailable?: (available: boolean) => void;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const image = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const element = image.current;
    if (photo.status === 'ready' && photo.url && element?.complete) {
      if (element.naturalWidth === 0) setFailedUrl(photo.url);
      onAvailable?.(element.naturalWidth > 0);
    }
  }, [photo.url, photo.status, onAvailable]);
  const failed = !!photo.url && failedUrl === photo.url;
  return photo.status === 'ready' && photo.url && !failed ? (
    <img
      ref={image}
      className={detail ? s.fullPhoto : s.thumbnail}
      src={photo.url}
      alt={detail ? photo.description || photo.title : ''}
      onLoad={() => onAvailable?.(true)}
      onError={() => {
        setFailedUrl(photo.url);
        onAvailable?.(false);
      }}
      loading={detail ? 'eager' : 'lazy'}
    />
  ) : (
    <div className={s.placeholder}>
      <Icon name="image" />
      <span>{failed ? '加载失败' : labels[photo.status]}</span>
      {failed && detail && (
        <button type="button" onClick={() => setFailedUrl(undefined)}>
          重新加载照片
        </button>
      )}
    </div>
  );
}
function UploadPhoto() {
  const { actions, operations, run } = usePhoneApps();
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<{ file: File; signature: string } | null>(null);
  const [error, setError] = useState('');
  const operation = operations['album-upload'];
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setDismissed(false);
    if (operation?.status === 'committed') setSelected(null);
  }, [operation, error]);
  async function upload(selection: { file: File; signature: string }) {
    const receipt = await run('album-upload', selection.signature, (commandId) =>
      actions.uploadPhoto!(selection.file, commandId),
    );
    if (receipt?.status === 'committed') setSelected(null);
  }
  if (!actions.uploadPhoto) return null;
  const pending = operation?.busy || operation?.status === 'accepted';
  return (
    <div className={s.upload}>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="选择相册照片"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file || pending) return;
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
        type="button"
        className={s.add}
        aria-label={pending ? '正在保存照片' : '添加照片'}
        disabled={pending}
        onClick={() => input.current?.click()}
      >
        <Icon name="plus" />
      </button>
      {!dismissed && (error || operation) && (
        <div className={s.uploadFeedback}>
          <button
            type="button"
            className={s.dismissUpload}
            aria-label="关闭上传提示"
            onClick={() => setDismissed(true)}
          >
            <Icon name="close" />
          </button>
          {error ? (
            <p role="alert">{error}</p>
          ) : (
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
          )}
          {!selected && operation?.status === 'failed' && (
            <p className={s.muted}>请重新选择原图；离开页面后未保留本次待上传文件。</p>
          )}
          {selected &&
            operation?.status === 'failed' &&
            operation.errorCode !== 'INVALID_INPUT' && (
              <button type="button" onClick={() => void upload(selected)}>
                重试这张照片
              </button>
            )}
        </div>
      )}
    </div>
  );
}
function PhotoInfo({
  photo,
  close,
  open,
  imageAvailable,
  visible,
}: {
  photo: PhonePhoto;
  imageAvailable: boolean;
  visible: boolean;
  close: () => void;
  open: PhoneAppContext['open'];
}) {
  const { data, actions, operations, run, setDraft, bringDraft } = usePhoneApps();
  const dialog = useRef<HTMLDivElement>(null);
  const [actorId, setActorId] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!visible) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = dialog.current;
    panel?.querySelector<HTMLElement>('button')?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
      if (event.key !== 'Tab' || !panel) return;
      const controls = [
        ...panel.querySelectorAll<HTMLElement>('button:not(:disabled), select, [tabindex="0"]'),
      ];
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      previous?.focus();
    };
  }, [close, visible]);
  const retry = operations[`photo:${photo.id}`];
  return (
    <div className={s.overlay} onClick={close} hidden={!visible}>
      <div
        ref={dialog}
        className={s.sheet}
        role="dialog"
        aria-modal="true"
        aria-label="照片信息"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={s.sheetHeader}>
          <h3>照片信息</h3>
          <button type="button" aria-label="关闭照片信息" onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        <div className={s.sheetBody}>
          <h4>{photo.title}</h4>
          <p className={s.muted}>
            {photo.sourcePersonId &&
            photo.links?.some(
              (link) => link.app === 'notes' && link.target.startsWith('sys/history/'),
            )
              ? '相关人物带入素材'
              : '照片来源'}
          </p>
          <p className={s.muted}>
            {photoSourceLabel(photo)} ·{' '}
            <time dateTime={photo.date}>
              {photo.sourcePersonId ? '上传于 ' : '世界记录于 '}
              {photoDay(photo.date)}
            </time>
          </p>
          {photo.sourcePersonId && (
            <p className={s.muted}>日期为原图上传时间，不代表拍摄时间或共同经历。</p>
          )}
          {photo.description && <p className={s.description}>{photo.description}</p>}
          <Links links={photo.links} open={open} />
          {photo.status === 'ready' && photo.url && actions.setWallpaper && imageAvailable && (
            <button
              type="button"
              className={s.action}
              onClick={() => {
                actions.setWallpaper!(photo.url!);
                setNotice('已设为这部手机的壁纸');
              }}
            >
              设为手机壁纸
            </button>
          )}
          {notice && (
            <p role="status" className={s.muted}>
              {notice}
            </p>
          )}
          {(photo.status === 'failed' || photo.status === 'unknown') && (
            <div className={s.retry}>
              <p>
                {photo.status === 'unknown'
                  ? '上次生成结果尚未确认。请先刷新核对，确认重试可能再次发起生成。'
                  : actions.retryPhoto
                    ? '这张照片没能生成，可以再试一次。'
                    : '这张照片没能生成，重试入口暂未接入。'}
              </p>
              {actions.retryPhoto && (
                <button
                  type="button"
                  className={s.action}
                  disabled={!actions.retryPhoto || retry?.busy || retry?.status === 'accepted'}
                  onClick={() =>
                    void run(`photo:${photo.id}`, photo.id, (id) =>
                      actions.retryPhoto!(photo.id, id),
                    )
                  }
                >
                  {photo.status === 'unknown' ? '确认重试生成' : '重新生成'}
                </button>
              )}
            </div>
          )}
          <Feedback operation={retry} success="重试已完成，请查看照片状态" />
          {data.contacts.length > 0 && (
            <div className={s.discuss}>
              <label htmlFor="photo-contact">聊聊这张照片</label>
              <select
                id="photo-contact"
                value={actorId}
                onChange={(event) => setActorId(event.target.value)}
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
                className={s.action}
                disabled={!actorId}
                onClick={() => {
                  const contact = data.contacts.find((c) => c.id === actorId);
                  if (!contact) return;
                  bringDraft(`message:${contact.id}`, `想和你聊聊相册里的《${photo.title}》。`);
                  open('messages', contact.id);
                }}
              >
                打开聊天
              </button>
              <small className={s.muted}>带入一句聊天草稿，由你发送。</small>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function PhotoShareSheet({
  photo,
  close,
  open,
  visible,
}: {
  photo: PhonePhoto;
  visible: boolean;
  close: () => void;
  open: PhoneAppContext['open'];
}) {
  const { data, actions, run, bringDraft } = usePhoneApps();
  const dialog = useRef<HTMLDivElement>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = dialog.current;
    panel?.querySelector<HTMLElement>('button')?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    }
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      previous?.focus();
    };
  }, [close, visible]);

  if (!visible) return null;

  return (
    <div className={s.overlay} onClick={close}>
      <div
        ref={dialog}
        className={s.sheet}
        role="dialog"
        aria-modal="true"
        aria-label="分享照片到聊天"
        onClick={(event) => event.stopPropagation()}
        style={{ maxHeight: '82%' }}
      >
        <header className={s.sheetHeader}>
          <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>分享照片到聊天</h3>
          <button type="button" aria-label="关闭分享" onClick={close}>
            <Icon name="close" />
          </button>
        </header>

        <div className={s.sheetBody} style={{ padding: '12px 16px', overflowY: 'auto' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 12px',
              background: '#ffffff',
              borderRadius: '12px',
              marginBottom: '16px',
              border: '1px solid #e2e8f0',
            }}
          >
            {photo.url ? (
              <img
                src={photo.url}
                alt={photo.title}
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '8px',
                  objectFit: 'cover',
                  flexShrink: 0,
                }}
              />
            ) : (
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '8px',
                  background: '#f1f5f9',
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon name="image" />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong
                style={{
                  display: 'block',
                  fontSize: '14px',
                  color: '#0f172a',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {photo.title}
              </strong>
              <small style={{ color: '#64748b', fontSize: '12px' }}>
                {photoDateLabel(photo.date)}
              </small>
            </div>
          </div>

          <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#64748b', fontWeight: 500 }}>
            选择要分享的联系人
          </h4>

          {data.contacts.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#94a3b8', padding: '24px 0' }}>
              暂无可分享的联系人
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {data.contacts.map((contact) => (
                <div
                  key={contact.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    background: '#ffffff',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '18px',
                        background: '#e0e7ff',
                        color: '#4338ca',
                        display: 'grid',
                        placeItems: 'center',
                        fontWeight: 600,
                        fontSize: '14px',
                        flexShrink: 0,
                      }}
                    >
                      {contact.name.slice(0, 1)}
                    </div>
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: '14px',
                        color: '#1e293b',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {contact.name}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    {actions.sendMessage && (
                      <button
                        type="button"
                        disabled={sendingId === contact.id}
                        style={{
                          padding: '6px 10px',
                          borderRadius: '8px',
                          border: 'none',
                          background: '#2563eb',
                          color: '#ffffff',
                          fontSize: '12px',
                          fontWeight: 500,
                          cursor: 'pointer',
                        }}
                        onClick={async () => {
                          setSendingId(contact.id);
                          playTapSound();
                          const shareText = `[分享了相册照片：《${photo.title}》]`;
                          try {
                            await run(`share-photo:${contact.id}`, shareText, (id) =>
                              actions.sendMessage!(contact.id, shareText, id, photo),
                            );
                            close();
                            open('messages', contact.id);
                          } finally {
                            setSendingId(null);
                          }
                        }}
                      >
                        {sendingId === contact.id ? '发送中…' : '发送原图'}
                      </button>
                    )}
                    <button
                      type="button"
                      style={{
                        padding: '6px 10px',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        background: '#f8fafc',
                        color: '#334155',
                        fontSize: '12px',
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                      onClick={() => {
                        playTapSound();
                        bringDraft(`message:${contact.id}`, `想和你聊聊相册里的《${photo.title}》。`);
                        close();
                        open('messages', contact.id);
                      }}
                    >
                      带入草稿
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <small style={{ display: 'block', marginTop: '12px', color: '#94a3b8', fontSize: '11px', textAlign: 'center' }}>
            发送或带入草稿均会完整保留你在聊天框中已输入的文字，不会被覆盖。
          </small>
        </div>
      </div>
    </div>
  );
}
export function PhotosApp({ target, open }: PhoneAppContext) {
  const { data, worldId } = usePhoneApps();
  const [imageAvailable, setImageAvailable] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [showInfo, setShowInfo] = useState(false);
  const closeInfo = useCallback(() => setShowInfo(false), []);
  const [showShare, setShowShare] = useState(false);
  const closeShare = useCallback(() => setShowShare(false), []);
  const ordered = useMemo(() => sortedPhotos(data.photos), [data.photos]);
  const albums = useMemo(
    () => photoAlbums(data.photos, data.contacts),
    [data.photos, data.contacts],
  );
  const view = readPhotoView(target, data.photos, albums);
  const collection = view.kind === 'collection' ? view.album : undefined;
  const visible = collection?.photos ?? ordered;
  const groups = photoGroups(visible);
  const viewportKey = JSON.stringify([worldId, target ?? '']);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    element.scrollTop = viewportPositions.get(viewportKey) ?? 0;
    return () => {
      if (viewportPositions.size >= 100 && !viewportPositions.has(viewportKey))
        viewportPositions.delete(viewportPositions.keys().next().value!);
      viewportPositions.set(viewportKey, element.scrollTop);
    };
  }, [viewportKey]);
  const photo = view.kind === 'photo' ? view.photo : undefined;
  const photoBack = view.kind === 'photo' ? view.back : undefined;
  const backAlbum = photoBack?.startsWith('album:')
    ? albums.find((a) => `album:${a.id}` === photoBack)
    : undefined;
  const detailPhotos = backAlbum?.photos ?? ordered;
  const index = photo ? detailPhotos.findIndex((p) => p.id === photo.id) : -1;
  function go(next?: string) {
    playTapSound();
    open('photos', next);
  }
  function replaceView(next?: string) {
    playTapSound();
    const hash = routeHash(worldId, { app: 'photos', ...(next ? { target: next } : {}) });
    const existing = window.history.state?.plPhone;
    const from = existing?.worldId === worldId ? existing.from : routeHash(worldId, { app: null });
    window.history.replaceState(
      { ...window.history.state, plPhone: { worldId, from, to: hash } },
      '',
      hash,
    );
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
  function back(next?: string) {
    const entry = window.history.state?.plPhone;
    if (entry?.worldId === worldId && entry.to === window.location.hash) {
      const previous = readRoute(entry.from, worldId);
      if (previous.app === 'photos' && previous.target === next) {
        playTapSound();
        window.history.back();
        return;
      }
    }
    replaceView(next);
  }
  if (view.kind === 'missing')
    return (
      <div className={s.root} data-phone-fixed-dock>
        <header className={s.toolbar}>
          <button type="button" onClick={() => go()}>
            <Icon name="back" />
            图库
          </button>
        </header>
        <div className={s.empty}>
          <Icon name="image" />
          <h3>找不到这张照片</h3>
          <p>返回图库，查看当前人生的照片。</p>
        </div>
      </div>
    );
  if (photo)
    return (
      <div className={`${s.root} ${s.detail}`} data-phone-fixed-dock>
        <header className={s.detailHeader}>
          <button
            type="button"
            aria-label={`返回${backAlbum?.title ?? (photoBack === 'albums' ? '相簿' : '图库')}`}
            onClick={() => back(photoBack)}
          >
            <Icon name="back" />
          </button>
          <div>
            <strong>{photoDateLabel(photo.date)}</strong>
            <span>{photo.sourcePersonId ? '原图上传时间' : '世界记录时间'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              type="button"
              aria-label="分享照片到聊天"
              title="分享照片到聊天"
              onClick={() => setShowShare(true)}
            >
              <Icon name="share" />
            </button>
            <button
              type="button"
              aria-label="查看照片信息"
              aria-expanded={showInfo}
              onClick={() => setShowInfo(true)}
            >
              <Icon name="info" />
            </button>
          </div>
        </header>
        <div className={s.photoStage}>
          <PhotoImage
            key={`${photo.id}:${photo.url}`}
            photo={photo}
            detail
            onAvailable={setImageAvailable}
          />
        </div>
        <footer className={s.viewerBar}>
          <button
            type="button"
            aria-label="上一张照片"
            disabled={index <= 0}
            onClick={() => {
              const previous = detailPhotos[index - 1];
              if (previous) replaceView(photoTarget(previous.id, photoBack));
            }}
          >
            <Icon name="back" />
          </button>
          <span>
            {index + 1} / {detailPhotos.length}
          </span>
          <button
            type="button"
            aria-label="下一张照片"
            disabled={index < 0 || index >= detailPhotos.length - 1}
            onClick={() => {
              const next = detailPhotos[index + 1];
              if (next) replaceView(photoTarget(next.id, photoBack));
            }}
          >
            <Icon name="next" />
          </button>
        </footer>
        <PhotoShareSheet
          photo={photo}
          close={closeShare}
          open={open}
          visible={showShare}
        />
        <PhotoInfo
          photo={photo}
          close={closeInfo}
          open={open}
          imageAvailable={imageAvailable}
          visible={showInfo}
        />
      </div>
    );
  const inAlbums = view.kind === 'albums' || view.kind === 'collection';
  return (
    <div className={s.root} data-phone-fixed-dock>
      {collection ? (
        <header className={s.toolbar}>
          <button type="button" onClick={() => back('albums')}>
            <Icon name="back" />
            相簿
          </button>
          <h2>{collection.title}</h2>
          <UploadPhoto />
        </header>
      ) : (
        <header className={s.libraryHeader}>
          <div>
            <h2>{inAlbums ? '相簿' : '图库'}</h2>
          </div>
          <UploadPhoto />
        </header>
      )}
      <div className={s.libraryBody} ref={scroller}>
        {view.kind === 'albums' && data.photos.length > 0 ? (
          <div className={s.albumGrid}>
            {albums.map((album) => (
              <button
                type="button"
                className={s.album}
                key={album.id}
                onClick={() => go(`album:${album.id}`)}
              >
                <div className={s.albumCover}>
                  <PhotoImage
                    key={`${album.photos[0]?.id}:${album.photos[0]?.url}`}
                    photo={album.photos[0]!}
                  />
                </div>
                <strong>{album.title}</strong>
                <span>{album.photos.length} 张</span>
              </button>
            ))}
          </div>
        ) : visible.length > 0 ? (
          <>
            {groups.map((group) => (
              <section key={group.id} className={s.day}>
                <h3>{group.label}</h3>
                <div className={s.grid}>
                  {group.photos.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={s.tile}
                      aria-label={`查看照片：${item.title}`}
                      onClick={() => go(photoTarget(item.id, target))}
                    >
                      <PhotoImage key={`${item.id}:${item.url}`} photo={item} />
                    </button>
                  ))}
                </div>
              </section>
            ))}
            <p className={s.count}>{visible.length} 张照片</p>
          </>
        ) : (
          <div className={s.empty}>
            <Icon name="image" />
            <h3>暂无照片</h3>
            <p>点右上角添加照片，留在这段人生里。</p>
          </div>
        )}
      </div>
      <nav className={s.tabBar} aria-label="相册导航">
        <button type="button" aria-current={!inAlbums ? 'page' : undefined} onClick={() => go()}>
          <Icon name="grid" />
          <span>图库</span>
        </button>
        <button
          type="button"
          aria-current={inAlbums ? 'page' : undefined}
          onClick={() => go('albums')}
        >
          <Icon name="albums" />
          <span>相簿</span>
        </button>
      </nav>
    </div>
  );
}
