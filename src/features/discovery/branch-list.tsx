'use client';
import { Icon } from '../../components/ui.tsx';
import { LifeCard } from './life-card.tsx';
export interface BranchEntry {
  id: string;
  title: string;
  status: string;
  ready?: boolean;
  imageUrl?: string;
  imageLabel?: string;
  description?: string;
  identity?: string;
  premise?: string;
  tradeoff?: string;
  experienceNote?: string;
}
export function BranchList({
  items,
  onOpen,
  disabled = false,
  label = '我的分支',
}: {
  items: BranchEntry[];
  onOpen: (id: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <section className="saved-lives" aria-label={label}>
      <div className="branch-section-label">
        <strong>{label}</strong>
        <span>{items.length}</span>
      </div>
      {items.map((item, index) => (
        <LifeCard
          key={item.id}
          title={item.title}
          description={item.description}
          identity={item.identity}
          imageUrl={item.imageUrl}
          imageLabel={item.imageLabel ?? '你的照片'}
          fallbackUrl={
            ['/art/first-window.webp', '/art/meadow-door.webp', '/art/open-door.webp'][index % 3]
          }
          detail={
            <>
              {item.premise && <p>{item.premise}</p>}
              {item.description && item.description !== item.premise && <p>{item.description}</p>}
              {item.tradeoff && (
                <p>
                  <strong>这条路的另一面</strong>
                  <br />
                  {item.tradeoff}
                </p>
              )}
              <p>
                {item.experienceNote ??
                  (item.ready
                    ? '继续这段人生。手机中的人物、来信和经历会承接你之前的选择。'
                    : '起点还在准备中，创建后才能进入手机体验。')}
              </p>
            </>
          }
        >
          <button
            type="button"
            disabled={disabled}
            onClick={() => onOpen(item.id)}
            aria-label={`${item.title}，${item.status}`}
          >
            <span>{item.status}</span>
            <Icon name="arrow" size={19} />
          </button>
        </LifeCard>
      ))}
    </section>
  );
}
