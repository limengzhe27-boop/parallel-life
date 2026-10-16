'use client';

import { useRef, useState } from 'react';
import s from './moment-gallery.module.css';

/** Both the author and player inspect the same ordered set of photographs. */
export function MomentGallery({ images, label }: { images: readonly string[]; label: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  if (!images.length) return null;
  const show = (next: number) => {
    setIndex(next);
    setFailed(false);
    if (!dialog.current?.open) dialog.current?.showModal();
  };
  return (
    <div className={s.container}>
      <div
        className={s.grid}
        style={{ gridTemplateColumns: `repeat(${Math.min(3, images.length)}, minmax(0, 1fr))` }}
      >
        {images.map((url, i) => (
          <button
            key={`${url}-${i}`}
            type="button"
            className={s.thumbnail}
            onClick={() => show(i)}
            aria-label={`${label}，查看第${i + 1}张图片`}
          >
            <img src={url} alt={`${label}，图片${i + 1}`} />
          </button>
        ))}
      </div>
      <dialog
        ref={dialog}
        className={s.viewer}
        aria-label={`${label}图片预览`}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' && index > 0) show(index - 1);
          if (event.key === 'ArrowRight' && index + 1 < images.length) show(index + 1);
        }}
      >
        <div className={s.toolbar}>
          <span>
            {index + 1} / {images.length}
          </span>
          <button type="button" onClick={() => dialog.current?.close()} aria-label="关闭图片预览">
            关闭
          </button>
        </div>
        {failed ? (
          <div role="alert" className={s.feedback}>
            图片暂时无法打开。
            <button
              type="button"
              onClick={() => {
                setFailed(false);
                setRetry((v) => v + 1);
              }}
            >
              重试
            </button>
          </div>
        ) : (
          <img
            key={`${index}-${retry}`}
            className={s.fullImage}
            src={images[index]}
            alt={`${label}，图片${index + 1}`}
            onError={() => setFailed(true)}
          />
        )}
        {images.length > 1 && (
          <div className={s.navigation}>
            <button type="button" disabled={index === 0} onClick={() => show(index - 1)}>
              上一张
            </button>
            <button
              type="button"
              disabled={index === images.length - 1}
              onClick={() => show(index + 1)}
            >
              下一张
            </button>
          </div>
        )}
      </dialog>
    </div>
  );
}
