'use client';
import type { LifeDirection } from '../../contracts/discovery.ts';
import { LifeCard } from './life-card.tsx';
import s from './official-lives.module.css';

/** A generated proposal shares the card, but never pretends to be a playable save. */
export function DirectionCard({
  direction,
  index,
  disabled,
  busy,
  onReview,
  onRefine,
}: {
  direction: LifeDirection;
  index: number;
  disabled: boolean;
  busy: boolean;
  onReview: () => void;
  onRefine: () => void;
}) {
  return (
    <LifeCard
      id={`direction-${direction.id}`}
      title={direction.title}
      description={direction.opening || direction.premise}
      fallbackUrl={
        ['/art/first-window.webp', '/art/meadow-door.webp', '/art/open-door.webp'][index % 3]
      }
      detail={
        <>
          <p>{direction.premise}</p>
          <p>{direction.opening}</p>
          <p>
            <strong>为什么想到这段人生</strong>
            <br />
            {direction.reason}
          </p>
          {direction.sources.length > 0 && (
            <ul>
              {direction.sources.map((source) => (
                <li key={source.factId}>{source.value}</li>
              ))}
            </ul>
          )}
          <p>
            <strong>这条路的另一面</strong>
            <br />
            {direction.tradeoff}
          </p>
          <p>这是构思出的起点，创建后才能进入手机。人物关系与后续经历会在体验中逐步展开。</p>
        </>
      }
    >
      <div className={s.buttonGroup}>
        <button type="button" disabled={disabled} onClick={onReview}>
          <span>{busy ? '正在读取草案…' : '查看人生起点'}</span>
          <span aria-hidden="true">↗</span>
        </button>
        <button type="button" className={s.secondaryButton} disabled={disabled} onClick={onRefine}>
          按这个方向另作构思
        </button>
      </div>
    </LifeCard>
  );
}
