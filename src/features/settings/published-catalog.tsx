'use client';
import {
  PublicationPlayerCatalogSchema,
  type PublicationPlayerCatalog,
} from '../../contracts/publication-worlds.ts';
import { Icon } from '../../components/ui.tsx';
import styles from './published-catalog.module.css';

export type PublishedCatalogProps = {
  catalog: PublicationPlayerCatalog | null;
  loading: boolean;
  error: string | null;
  startingWorkId: string | null;
  onStart: (card: PublicationPlayerCatalog['works'][number]) => void;
  onReload: () => void;
  onNext?: () => void;
};
/** Controlled safe catalog view. No connection, navigation, model or persistence effects. */
export function PublishedCatalog({
  catalog,
  loading,
  error,
  startingWorkId,
  onStart,
  onReload,
  onNext,
}: PublishedCatalogProps) {
  const parsed = catalog === null ? null : PublicationPlayerCatalogSchema.safeParse(catalog);
  const invalid = parsed !== null && !parsed.success;
  const data = parsed?.success ? parsed.data : null;
  const failure = error || (invalid ? '世界目录暂时无法显示，请重新读取。' : null);
  const starting = startingWorkId !== null;
  const disabled = loading || starting || Boolean(failure);
  const reload = (
    <button
      className={styles.reload}
      type="button"
      disabled={loading || starting}
      onClick={() => {
        if (!loading && !starting) onReload();
      }}
    >
      重新读取
    </button>
  );
  return (
    <section className={styles.catalog} aria-label="已发布的世界" aria-busy={loading || starting}>
      <header className={styles.header}>
        <h2>已发布的世界</h2>
        <p>选择一段人生，进入属于你的世界。</p>
      </header>
      {loading && (
        <p className={styles.state} role="status">
          {data ? '正在刷新世界目录…' : '正在读取已发布的世界…'}
        </p>
      )}
      {failure && (
        <div className={styles.notice} role="alert">
          <p>{failure}</p>
          {data?.works.length ? <p>下面是上次读取的目录，刷新后再进入。</p> : null}
          {reload}
        </div>
      )}
      {!loading && !starting && !failure && !data && (
        <div className={styles.state}>
          <p>世界目录暂未开放，请稍后再试。</p>
          {reload}
        </div>
      )}
      {!loading && !starting && !failure && data?.works.length === 0 && (
        <p className={styles.state}>还没有已发布的世界。</p>
      )}
      {starting && (
        <p className={styles.state} role="status">
          正在打开这段人生，请稍候…
        </p>
      )}
      {data && data.works.length > 0 && (
        <div className={styles.list}>
          {data.works.map((card) => {
            const pending = card.id === startingWorkId;
            const action = card.worldId ? '继续这段人生' : '进入体验';
            return (
              <article
                key={card.id}
                className={styles.card}
                aria-label={card.title}
                aria-busy={pending}
              >
                {card.coverUrl ? (
                  <img
                    className={styles.cover}
                    src={card.coverUrl}
                    alt={`${card.title} · 创作封面`}
                    loading="lazy"
                  />
                ) : null}
                <p className={styles.identity}>
                  <span>你的身份</span>
                  {card.identityLabel}
                </p>
                <h3>{card.title}</h3>
                <p className={styles.hook}>{card.hook}</p>
                <details className={styles.details}>
                  <summary>体验说明</summary>
                  <div>
                    <p>{card.description}</p>
                    <p className={styles.experience}>{card.experienceNote}</p>
                  </div>
                </details>
                <button
                  className={styles.start}
                  type="button"
                  disabled={disabled}
                  aria-label={`${card.title}，${pending ? '正在打开' : action}`}
                  onClick={() => {
                    if (!disabled) onStart(card);
                  }}
                >
                  <span>{pending ? '正在打开…' : action}</span>
                  <Icon name="arrow" size={18} />
                </button>
              </article>
            );
          })}
        </div>
      )}
      {data?.nextCursor && onNext && (
        <button
          className={styles.next}
          type="button"
          disabled={disabled}
          onClick={() => {
            if (!disabled) onNext();
          }}
        >
          查看更多世界
        </button>
      )}
      {data && !failure && !loading && <div className={styles.refresh}>{reload}</div>}
    </section>
  );
}
