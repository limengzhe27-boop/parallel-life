import { useState } from 'react';
import { SELECTABLE_STICKERS } from '../../../modules/world/domain/stickers.ts';
import s from './sticker-ui.module.css';

type Sticker = { id: string; src: string; label: string };
export function StickerImage({
  sticker,
  thumbnail = false,
}: {
  sticker: Sticker;
  thumbnail?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string>();
  return failedSrc === sticker.src ? (
    <span className={s.fallback} role="img" aria-label={sticker.label}>
      [{sticker.label} · 图片未加载]
    </span>
  ) : (
    <img
      className={thumbnail ? s.thumbnail : s.image}
      src={sticker.src}
      alt={sticker.label}
      loading={thumbnail ? 'eager' : 'lazy'}
      onError={() => setFailedSrc(sticker.src)}
    />
  );
}

export function StickerPicker({
  emojis,
  disabled,
  onEmoji,
  onSticker,
}: {
  emojis: string[];
  disabled: boolean;
  onEmoji: (emoji: string) => void;
  onSticker: (id: string) => void;
}) {
  const [mode, setMode] = useState<'stickers' | 'emoji'>('stickers');
  return (
    <section className={s.panel} aria-label="表情选择">
      <div className={s.tabs}>
        <button
          type="button"
          aria-pressed={mode === 'stickers'}
          onClick={() => setMode('stickers')}
        >
          图片表情
        </button>
        <button type="button" aria-pressed={mode === 'emoji'} onClick={() => setMode('emoji')}>
          Emoji
        </button>
      </div>
      <div className={mode === 'stickers' ? s.grid : s.emojis}>
        {mode === 'stickers'
          ? SELECTABLE_STICKERS.map((sticker) => (
              <button
                type="button"
                key={sticker.id}
                disabled={disabled}
                aria-label={`发送表情：${sticker.label}`}
                onClick={() => onSticker(sticker.id)}
              >
                <StickerImage sticker={sticker} thumbnail />
                <span>{sticker.label}</span>
              </button>
            ))
          : emojis.map((emoji) => (
              <button
                type="button"
                key={emoji}
                aria-label={`插入 ${emoji}`}
                onClick={() => onEmoji(emoji)}
              >
                {emoji}
              </button>
            ))}
      </div>
    </section>
  );
}
