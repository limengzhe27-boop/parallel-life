'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';

const heights = [24, 54, 88] as const;
/** UI preference only: never changes scene time, task state or model work. */
export function SceneReadingHandle({
  sceneKey,
  container,
  onHeight,
}: {
  sceneKey: string;
  container: RefObject<HTMLDivElement | null>;
  onHeight: (height: number) => void;
}) {
  const [height, setHeight] = useState<number>(54);
  const drag = useRef<{ y: number; height: number; moved: boolean } | null>(null);
  const currentHeight = useRef(54);
  function change(value: number) {
    const next = Math.min(88, Math.max(24, value));
    currentHeight.current = next;
    setHeight(next);
    onHeight(next);
  }
  function save(value: number) {
    try {
      sessionStorage.setItem('pl-scene-height:' + sceneKey, String(value));
    } catch {}
  }
  useEffect(() => {
    let next = 54;
    try {
      const saved = sessionStorage.getItem('pl-scene-height:' + sceneKey);
      if (saved !== null && Number.isFinite(Number(saved))) next = Number(saved);
    } catch {}
    change(next);
  }, [sceneKey]);
  return (
    <button
      type="button"
      role="slider"
      aria-label="对话区域高度"
      aria-valuemin={24}
      aria-valuemax={88}
      aria-valuenow={Math.round(height)}
      aria-valuetext={height < 39 ? '收起' : height > 71 ? '展开阅读' : '默认'}
      data-scene-reading-handle
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        drag.current = { y: event.clientY, height: currentHeight.current, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        const available = container.current?.clientHeight;
        if (!start || !available) return;
        const delta = start.y - event.clientY;
        if (Math.abs(delta) > 3) start.moved = true;
        if (start.moved) change(start.height + (delta / available) * 100);
      }}
      onPointerUp={(event) => {
        const start = drag.current;
        if (!start) return;
        const next = start.moved
          ? heights.reduce((a, b) =>
              Math.abs(b - currentHeight.current) < Math.abs(a - currentHeight.current) ? b : a,
            )
          : (heights.find((h) => h > currentHeight.current + 1) ?? 24);
        change(next);
        save(next);
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
        save(currentHeight.current);
      }}
      onKeyDown={(event) => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        const next =
          event.key === 'Home'
            ? 24
            : event.key === 'End'
              ? 88
              : event.key === 'ArrowDown'
                ? ([...heights].reverse().find((h) => h < height - 1) ?? 24)
                : (heights.find((h) => h > height + 1) ?? 24);
        change(next);
        save(next);
      }}
    >
      <span aria-hidden="true" />
      <small className="sr-only">
        {height < 39 ? '展开对话' : height > 71 ? '收起阅读' : '拖动调整对话'}
      </small>
    </button>
  );
}
