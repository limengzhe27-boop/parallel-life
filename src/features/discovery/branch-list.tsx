'use client';
import { Icon } from '../../components/ui.tsx';
export interface BranchEntry {
  id: string;
  title: string;
  status: string;
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
      <h2 className="branch-section-label">全部 {items.length}</h2>
      {items.map((item) => (
        <button
          type="button"
          className="saved-life-card"
          key={item.id}
          onClick={() => onOpen(item.id)}
          aria-label={`${item.title}，${item.status}`}
        >
          <span className="saved-life-icon">
            <Icon name="photo" size={26} />
          </span>
          <span>
            <strong>{item.title}</strong>
            <small>{item.status}</small>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      ))}
    </section>
  );
}
