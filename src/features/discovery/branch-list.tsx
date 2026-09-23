'use client';
import { Icon } from '../../components/ui.tsx';
export interface BranchEntry {
  id: string;
  title: string;
  status: string;
  ready?: boolean;
  imageUrl?: string;
}
export function BranchList({
  items,
  onOpen,
}: {
  items: BranchEntry[];
  onOpen: (id: string) => void;
}) {
  return (
    <section className="saved-lives" aria-label="我的人生分支">
      <div className="branch-section-label">
        <strong>我的分支</strong>
        <span>{items.length}</span>
      </div>
      {items.map((item) => (
        <button
          type="button"
          className="saved-life-card"
          key={item.id}
          onClick={() => onOpen(item.id)}
          aria-label={`${item.title}，${item.status}`}
        >
          <span className="saved-life-icon">
            {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <Icon name="photo" size={26} />}
          </span>
          <span>
            <strong>{item.title}</strong>
            <small className={item.ready ? 'branch-status-ready' : 'branch-status-pending'}>
              {item.status}
            </small>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      ))}
    </section>
  );
}
