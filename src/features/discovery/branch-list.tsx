'use client';
import { useState } from 'react';
import { Icon } from '../../components/ui.tsx';
export interface BranchEntry {
  id: string;
  title: string;
  status: string;
  ready?: boolean;
  imageUrl?: string;
  description?: string;
}
export function BranchList({
  items,
  onOpen,
  disabled = false,
}: {
  items: BranchEntry[];
  onOpen: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <section className="saved-lives" aria-label="我的人生分支">
      <div className="branch-section-label">
        <strong>我的分支</strong>
        <span>{items.length}</span>
      </div>
      {items.map((item, index) => (
        <BranchCard
          key={`${item.id}:${item.imageUrl ?? ''}`}
          item={item}
          index={index}
          disabled={disabled}
          onOpen={onOpen}
        />
      ))}
    </section>
  );
}

function BranchCard({
  item,
  index,
  disabled,
  onOpen,
}: {
  item: BranchEntry;
  index: number;
  disabled: boolean;
  onOpen: (id: string) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const hasPortrait = Boolean(item.imageUrl) && !imageFailed;
  return (
    <button
      type="button"
      className="saved-life-card"
      disabled={disabled}
      onClick={() => onOpen(item.id)}
      aria-label={`${item.title}，${item.status}`}
    >
      <img
        className="branch-cover"
        src={
          hasPortrait
            ? item.imageUrl
            : ['/art/first-window.webp', '/art/meadow-door.webp', '/art/open-door.webp'][index % 3]
        }
        alt=""
        loading="lazy"
        onError={hasPortrait ? () => setImageFailed(true) : undefined}
      />
      <span className="branch-cover-shade" aria-hidden="true" />
      <span className="branch-cover-label">{hasPortrait ? '你的照片' : '意境插画'}</span>
      <span className="branch-card-copy">
        <strong>{item.title}</strong>
        {item.description && <span className="branch-card-description">{item.description}</span>}
        <small className={item.ready ? 'branch-status-ready' : 'branch-status-pending'}>
          {item.status}
        </small>
      </span>
      <span className="branch-enter-arrow" aria-hidden="true">
        <Icon name="arrow" size={19} />
      </span>
    </button>
  );
}
