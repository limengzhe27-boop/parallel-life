'use client';
import { useId, useState, type ReactNode } from 'react';
import s from './life-card.module.css';

/** One presentation for authored lives, approved lives, and unfinished drafts. */
export function LifeCard({
  title,
  description,
  identity,
  imageUrl,
  imageLabel = '意境插画',
  fallbackUrl = '/art/first-window.webp',
  detail,
  children,
  pending = false,
}: {
  title: string;
  description?: string;
  identity?: string;
  imageUrl?: string;
  imageLabel?: string;
  fallbackUrl?: string;
  detail?: ReactNode;
  children: ReactNode;
  pending?: boolean;
}) {
  const titleId = useId();
  const [failedUrl, setFailedUrl] = useState<string>();
  const hasImage = imageUrl && failedUrl !== imageUrl;
  return (
    <article className={s.card} aria-labelledby={titleId} aria-busy={pending}>
      <div className={s.cover}>
        <img
          className={s.image}
          src={hasImage ? imageUrl : fallbackUrl}
          alt=""
          loading="lazy"
          onError={hasImage ? () => setFailedUrl(imageUrl) : undefined}
        />
        <div className={s.shade} aria-hidden="true" />
        <span className={s.artLabel}>{hasImage ? imageLabel : '意境插画'}</span>
        <div className={s.copy}>
          {identity && <span className={s.identity}>{identity}</span>}
          <h3 id={titleId}>{title}</h3>
          {description && <p>{description}</p>}
        </div>
      </div>
      <div className={s.actions}>
        {children}
        {detail && (
          <details className={s.experienceDetails}>
            <summary>体验说明</summary>
            <div className={s.detail}>{detail}</div>
          </details>
        )}
      </div>
    </article>
  );
}
