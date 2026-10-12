'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { OfficialLifeCard, OfficialLifeId } from '../../contracts/official-lives.ts';
import {
  OfficialLifeCommands,
  OfficialLivesClient,
  OfficialLivesFailure,
} from './official-lives-client.ts';
import styles from './official-lives.module.css';
import { LifeCard } from './life-card.tsx';
import { resolveOfficialLifeArt } from './life-art.ts';
import type { BranchCategory } from './branch-list.tsx';
import categoryStyles from './discovery-category.module.css';

export type OfficialLifeArtwork = 'garage' | 'lake' | 'house' | 'stage';
export interface OfficialLifeCardView {
  id: string;
  title: string;
  hook: string;
  artwork: OfficialLifeArtwork;
  hasSave: boolean;
  worldId?: string | null;
  identity?: string;
  experienceNote?: string;
  version?: number;
  hasNewVersion?: boolean;
  legacyWorldId?: string | null;
  currentVersionWorldId?: string | null;
}

const artworkById: Record<OfficialLifeId, OfficialLifeArtwork> = {
  'county-yellow-hair': 'garage',
  'only-child': 'lake',
  'returned-daughter': 'house',
  'retired-star': 'stage',
};
const explain = (error: unknown) =>
  error instanceof OfficialLivesFailure ? error.message : '暂时无法打开，请保留这次操作再试。';

export function OfficialLives({
  connectSession,
  onCatalogChange,
  category = 'all',
  representedWorldIds = [],
  onShowFeatured,
}: {
  connectSession?: () => Promise<void>;
  onCatalogChange?: (cards: readonly OfficialLifeCard[]) => void;
  category?: BranchCategory;
  representedWorldIds?: readonly string[];
  onShowFeatured?: () => void;
}) {
  const [client] = useState(() => new OfficialLivesClient(undefined, connectSession));
  const commands = useRef<OfficialLifeCommands | null>(null);
  const [cards, setCards] = useState<OfficialLifeCard[]>([]);
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const sending = useRef(false),
    mounted = useRef(false),
    readSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++readSequence.current;
    setLoading(true);
    setLoadError('');
    try {
      const result = await client.list();
      if (!mounted.current || sequence !== readSequence.current) return;
      setCards(result.lives);
      const recovery: Record<string, string> = {};
      for (const card of result.lives) {
        if (card.worldId) commands.current?.committed(card.id, card.version);
        else if (commands.current?.pending(card.id, card.version))
          recovery[card.id] = '上次打开的结果还未确认，再试会核对同一次操作。';
      }
      setErrors(recovery);
    } catch (error) {
      if (mounted.current && sequence === readSequence.current) setLoadError(explain(error));
    } finally {
      if (mounted.current && sequence === readSequence.current) setLoading(false);
    }
  }, [client]);
  useEffect(() => {
    mounted.current = true;
    let storage: Storage | undefined;
    try {
      storage = window.sessionStorage;
    } catch {
      /* Browser may disable storage. */
    }
    commands.current ??= new OfficialLifeCommands(storage);
    void load();
    return () => {
      mounted.current = false;
      readSequence.current++;
    };
  }, [load]);
  useEffect(() => {
    onCatalogChange?.(cards);
  }, [cards, onCatalogChange]);
  async function open(id: string) {
    const card = cards.find((item) => item.id === id);
    if (!card || sending.current || loading) return;
    if (card.worldId) {
      try {
        window.location.assign(`/worlds/${card.worldId}`);
      } catch {
        setErrors((old) => ({ ...old, [id]: '存档仍保留，暂时未能进入，请再试一次。' }));
      }
      return;
    }
    if (!commands.current) return;
    sending.current = true;
    setPendingId(id);
    setErrors((old) => ({ ...old, [id]: '' }));
    try {
      const request = commands.current.begin(card.id, card.version);
      const result = await client.start(card.id, request);
      commands.current.committed(card.id, card.version);
      if (!mounted.current) return;
      setCards((old) =>
        old.map((item) => (item.id === card.id ? { ...item, worldId: result.worldId } : item)),
      );
      try {
        window.location.assign(`/worlds/${result.worldId}`);
      } catch {
        setErrors((old) => ({ ...old, [id]: '手机已准备好，暂时未能进入，请再试一次。' }));
      }
    } catch (error) {
      if (mounted.current) setErrors((old) => ({ ...old, [id]: explain(error) }));
    } finally {
      sending.current = false;
      if (mounted.current) setPendingId(null);
    }
  }
  async function startNewVersion(id: string) {
    const card = cards.find((item) => item.id === id);
    if (!card || sending.current || loading) return;
    if (!commands.current) return;
    sending.current = true;
    setPendingId(id);
    setErrors((old) => ({ ...old, [id]: '' }));
    try {
      const request = commands.current.begin(card.id, card.version);
      const result = await client.start(card.id, request);
      commands.current.committed(card.id, card.version);
      if (!mounted.current) return;
      setCards((old) =>
        old.map((item) =>
          item.id === card.id
            ? {
                ...item,
                worldId: result.worldId,
                currentVersionWorldId: result.worldId,
                hasNewVersion: false,
              }
            : item,
        ),
      );
      try {
        window.location.assign(`/worlds/${result.worldId}`);
      } catch {
        setErrors((old) => ({ ...old, [id]: '手机已准备好，暂时未能进入，请再试一次。' }));
      }
    } catch (error) {
      if (mounted.current) setErrors((old) => ({ ...old, [id]: explain(error) }));
    } finally {
      sending.current = false;
      if (mounted.current) setPendingId(null);
    }
  }
  function openLegacy(id: string) {
    const card = cards.find((item) => item.id === id);
    if (!card?.legacyWorldId) return;
    try {
      window.location.assign(`/worlds/${card.legacyWorldId}`);
    } catch {
      setErrors((old) => ({ ...old, [id]: '存档仍保留，暂时未能进入，请再试一次。' }));
    }
  }
  return (
    <OfficialLivesView
      category={category}
      representedWorldIds={representedWorldIds}
      onShowFeatured={onShowFeatured}
      cards={cards.map((card) => ({
        id: card.id,
        title: card.title,
        hook: card.hook,
        identity: card.identityLabel,
        artwork: artworkById[card.id],
        hasSave: card.worldId !== null,
        worldId: card.worldId,
        experienceNote: card.experienceNote,
        version: card.version,
        hasNewVersion: card.hasNewVersion,
        legacyWorldId: card.legacyWorldId,
        currentVersionWorldId: card.currentVersionWorldId,
      }))}
      loading={loading}
      loadError={loadError}
      pendingId={pendingId}
      errors={errors}
      onOpen={(id) => {
        void open(id);
      }}
      onStartNewVersion={(id) => {
        void startNewVersion(id);
      }}
      onOpenLegacy={(id) => {
        openLegacy(id);
      }}
      onReload={() => {
        if (!sending.current) void load();
      }}
    />
  );
}

export interface OfficialSavedWorld {
  worldId: string;
  card: OfficialLifeCardView;
  legacy: boolean;
}
/** Only explicit catalog instance IDs are saves; hasSave alone never fabricates a world. */
export function officialSavedWorlds(
  cards: readonly OfficialLifeCardView[],
  representedWorldIds: readonly string[] = [],
): OfficialSavedWorld[] {
  const seen = new Set(representedWorldIds);
  return cards.flatMap((card) =>
    [card.currentVersionWorldId, card.worldId, card.legacyWorldId].flatMap((worldId) => {
      if (!worldId || seen.has(worldId)) return [];
      seen.add(worldId);
      return [
        {
          worldId,
          card,
          legacy: worldId === card.legacyWorldId && worldId !== card.currentVersionWorldId,
        },
      ];
    }),
  );
}

export function OfficialLivesView({
  cards,
  loading = false,
  loadError = '',
  pendingId = null,
  errors = {},
  onOpen,
  onStartNewVersion,
  onOpenLegacy,
  onReload,
  category = 'featured',
  representedWorldIds = [],
  onShowFeatured,
}: {
  cards: readonly OfficialLifeCardView[];
  category?: BranchCategory;
  representedWorldIds?: readonly string[];
  onShowFeatured?: () => void;
  loading?: boolean;
  loadError?: string;
  pendingId?: string | null;
  errors?: Readonly<Record<string, string>>;
  onOpen: (id: string) => void;
  onStartNewVersion?: (id: string) => void;
  onOpenLegacy?: (id: string) => void;
  onReload: () => void;
}) {
  const headingId = useId();
  if (category === 'mine') {
    const saves = officialSavedWorlds(cards, representedWorldIds);
    const recovery = cards.filter((card) => errors[card.id]);
    const alreadyListed = officialSavedWorlds(cards).some((save) =>
      representedWorldIds.includes(save.worldId),
    );
    return (
      <section className={styles.section} aria-labelledby={headingId}>
        <h2 className={categoryStyles.savedHeading} id={headingId}>
          从精选保存的人生
        </h2>
        {loadError ? (
          <div className={styles.loadError} role="alert">
            <p>{loadError}</p>
            <p>精选存档暂时无法核对，请重新读取目录。</p>
            <button type="button" onClick={onReload} disabled={loading}>
              重新加载
            </button>
          </div>
        ) : loading ? (
          <p className={styles.loading} role="status">
            正在核对已保存的精选人生…
          </p>
        ) : (
          <>
            {saves.length > 0 && (
              <div className={styles.list}>
                {saves.map(({ worldId, card, legacy }) => {
                  const art = resolveOfficialLifeArt(card.id);
                  return (
                    <LifeCard
                      key={worldId}
                      title={legacy ? `${card.title} · 原存档` : card.title}
                      description={
                        legacy
                          ? '保留此前版本的人物、来信和进展。'
                          : '你已经保存的精选人生，可以继续上次的故事。'
                      }
                      imageUrl={art?.coverUrl}
                      imageLabel={art?.label}
                      detail={
                        <p>
                          {legacy
                            ? '继续此存档会保留它创建时的设定，不会重建或自动改成新版。'
                            : '这是真实保存的手机世界。这里的入口继续现有存档，不会重新创建人生。'}
                        </p>
                      }
                    >
                      <a
                        className={categoryStyles.worldLink}
                        href={`/worlds/${encodeURIComponent(worldId)}`}
                      >
                        <span>{legacy ? '继续原存档' : '继续体验'}</span>
                        <span aria-hidden="true">↗</span>
                      </a>
                    </LifeCard>
                  );
                })}
              </div>
            )}
            {saves.length === 0 && recovery.length === 0 && !pendingId && (
              <p className={styles.loading}>
                {alreadyListed ? '精选存档已列在下方的我的分支中。' : '还没有保存的精选人生。'}
              </p>
            )}
          </>
        )}
        {pendingId && <p role="status">正在核对这次精选打开操作，未确认前不算新存档。</p>}
        {recovery.map((card) => (
          <p key={card.id} role="alert" className={styles.error}>
            {card.title}：{errors[card.id]}
          </p>
        ))}
        {(recovery.length > 0 || pendingId) && onShowFeatured && (
          <button type="button" onClick={onShowFeatured}>
            查看精选中的恢复操作
          </button>
        )}
        {!loadError && !loading && cards.length > 0 && (
          <button
            type="button"
            className={styles.refresh}
            onClick={onReload}
            disabled={pendingId !== null}
          >
            刷新人生目录
          </button>
        )}
      </section>
    );
  }
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.introduction}>
        <span className={styles.eyebrow}>精选 · 人生设定目录</span>
        <h2 id={headingId}>挑一段想体验的人生</h2>
        <p>从精选设定开始；有存档就继续，新版本由你选择开启。</p>
      </div>
      {loadError && (
        <div className={styles.loadError} role="alert">
          <p>{loadError}</p>
          <button type="button" onClick={onReload} disabled={loading}>
            重新加载
          </button>
        </div>
      )}
      {loading && cards.length === 0 && (
        <p className={styles.loading} role="status">
          正在打开人生目录…
        </p>
      )}
      {!loading && !loadError && cards.length === 0 && (
        <p className={styles.loading}>暂时没有可体验的人生副本。</p>
      )}
      <div className={styles.list}>
        {cards.map((card) => (
          <OfficialLifeCard
            key={card.id}
            card={card}
            pending={pendingId === card.id}
            disabled={loading || pendingId !== null}
            error={errors[card.id] ?? ''}
            onOpen={onOpen}
            onStartNewVersion={onStartNewVersion}
            onOpenLegacy={onOpenLegacy}
          />
        ))}
      </div>
      {cards.length > 0 && (
        <button
          type="button"
          className={styles.refresh}
          disabled={loading || pendingId !== null}
          onClick={onReload}
        >
          刷新人生目录
        </button>
      )}
    </section>
  );
}

export function OfficialLifeCard({
  card,
  pending,
  disabled,
  error,
  onOpen,
  onStartNewVersion,
  onOpenLegacy,
}: {
  card: OfficialLifeCardView;
  pending: boolean;
  disabled: boolean;
  error: string;
  onOpen: (id: string) => void;
  onStartNewVersion?: (id: string) => void;
  onOpenLegacy?: (id: string) => void;
}) {
  const errorId = useId();
  const art = resolveOfficialLifeArt(card.id);
  const action = pending
    ? '正在准备这部手机…'
    : card.hasSave
      ? '继续'
      : error
        ? '重新尝试'
        : '打开这部手机';
  return (
    <LifeCard
      title={card.title}
      description={card.hook}
      identity={card.identity}
      imageUrl={art?.coverUrl}
      imageLabel={art?.label}
      pending={pending}
      detail={card.experienceNote ? <p>{card.experienceNote}</p> : undefined}
    >
      {error && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
      {card.hasNewVersion ? (
        <>
          <div className={styles.versionNotice}>有新版地图 · 原存档已保留</div>
          <div className={styles.buttonGroup}>
            <button
              type="button"
              disabled={disabled}
              aria-label={`${card.title}，继续原存档`}
              aria-describedby={error ? errorId : undefined}
              onClick={() => onOpen(card.id)}
            >
              <span aria-live="polite">{pending ? '正在进入…' : '继续原存档'}</span>
              {!pending && <span aria-hidden="true">↗</span>}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={disabled}
              aria-label={`${card.title}，开启新版（原存档保留）`}
              aria-describedby={error ? errorId : undefined}
              onClick={() => onStartNewVersion?.(card.id)}
            >
              <span aria-live="polite">{pending ? '正在准备这部手机…' : '开启新版'}</span>
              {!pending && <span aria-hidden="true">↗</span>}
            </button>
          </div>
        </>
      ) : card.legacyWorldId && card.currentVersionWorldId ? (
        <>
          <div className={styles.versionNotice}>新版体验中 · 原存档保留</div>
          <div className={styles.buttonGroup}>
            <button
              type="button"
              disabled={disabled}
              aria-label={`${card.title}，继续新版`}
              aria-describedby={error ? errorId : undefined}
              onClick={() => onOpen(card.id)}
            >
              <span aria-live="polite">{pending ? '正在进入…' : '继续新版'}</span>
              {!pending && <span aria-hidden="true">↗</span>}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={disabled}
              aria-label={`${card.title}，返回原存档`}
              aria-describedby={error ? errorId : undefined}
              onClick={() => onOpenLegacy?.(card.id)}
            >
              <span aria-live="polite">返回原存档</span>
              <span aria-hidden="true">↗</span>
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          disabled={disabled}
          aria-label={`${card.title}，${action}`}
          aria-describedby={error ? errorId : undefined}
          onClick={() => onOpen(card.id)}
        >
          <span aria-live="polite">{action}</span>
          {!pending && <span aria-hidden="true">↗</span>}
        </button>
      )}
    </LifeCard>
  );
}
