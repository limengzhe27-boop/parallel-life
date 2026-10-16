'use client';
import { Icon } from '../../components/ui.tsx';
import { LifeCard } from './life-card.tsx';
import { resolveOfficialLifeArt } from './life-art.ts';
import type { ApprovedSeed } from '../../contracts/seeds.ts';
import type { WorldBuild } from '../../contracts/world-build.ts';
import type { OfficialLifeCard } from '../../contracts/official-lives.ts';
import categoryStyles from './discovery-category.module.css';
export interface BranchEntry {
  id: string;
  title: string;
  status: string;
  ready?: boolean;
  worldId?: string;
  imageUrl?: string;
  imageLabel?: string;
  description?: string;
  identity?: string;
  premise?: string;
  tradeoff?: string;
  experienceNote?: string;
}

export type BranchCategory = 'all' | 'featured' | 'mine';
export function BranchCategoryTabs({
  selected,
  onSelect,
}: {
  selected: BranchCategory;
  onSelect: (category: BranchCategory) => void;
}) {
  return (
    <nav className={categoryStyles.categories} aria-label="分支分类">
      {(
        [
          ['all', '全部'],
          ['featured', '精选'],
          ['mine', '我的'],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={selected === value}
          onClick={() => onSelect(value)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
/** Ready world identities, not template names or a queued build's reserved worldId. */
export function savedWorldIds(
  seeds: readonly ApprovedSeed[],
  builds: readonly WorldBuild[],
): string[] {
  return [
    ...new Set(
      seeds.flatMap((seed) => {
        const build = builds.find((item) => item.seedId === seed.id);
        return build?.ready ? [build.worldId] : [];
      }),
    ),
  ];
}
export function categorySavedSeeds(
  seeds: readonly ApprovedSeed[],
  builds: readonly WorldBuild[],
  catalog: readonly OfficialLifeCard[],
  category: BranchCategory,
): ApprovedSeed[] {
  if (category === 'featured') return [];
  const represented = new Set(
    category === 'all'
      ? catalog.flatMap((card) =>
          [card.worldId, card.currentVersionWorldId, card.legacyWorldId].filter(
            (id): id is string => Boolean(id),
          ),
        )
      : [],
  );
  const seen = new Set<string>();
  return seeds.filter((seed) => {
    const build = builds.find((item) => item.seedId === seed.id);
    if (build?.ready && represented.has(build.worldId)) return false;
    const key = build?.ready ? 'world:' + build.worldId : 'seed:' + seed.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function branchBuildLabel(build?: WorldBuild): string {
  if (build?.ready) return '继续体验';
  switch (build?.task?.status) {
    case 'queued':
    case 'running':
      return '正在准备 · 查看进度';
    case 'unknown':
      return '结果待确认 · 查看';
    case 'failed':
      return '生成未完成 · 查看恢复';
    case 'cancelled':
      return '已停止准备 · 查看';
    case 'conflict':
      return '需要更新 · 查看';
    default:
      return '查看人生起点';
  }
}

/** A saved seed owns its story; a newer catalog version cannot rewrite its identity. */
export function savedBranchEntry(
  seed: ApprovedSeed,
  build: WorldBuild | undefined,
  catalog: readonly OfficialLifeCard[],
): BranchEntry {
  const source = 'source' in seed && seed.source.kind === 'official_life' ? seed.source : null;
  const matchingVersion = source
    ? catalog.find((card) => card.id === source.presetId && card.version === source.version)
    : undefined;
  return {
    id: seed.id,
    title: seed.story.title,
    description: seed.story.opening || seed.story.premise,
    premise: seed.story.premise,
    tradeoff: seed.story.tradeoff,
    identity: seed.setup?.identity || matchingVersion?.identityLabel,
    ready: Boolean(build?.ready),
    worldId: build?.ready ? build.worldId : undefined,
    status: branchBuildLabel(build),
    imageUrl: seed.portraitAssetId
      ? `/api/v1/assets/${seed.portraitAssetId}`
      : source
        ? resolveOfficialLifeArt(source.presetId)?.coverUrl
        : undefined,
    imageLabel: seed.portraitAssetId ? '你的照片' : source ? '原创插画' : '你的照片',
  };
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
