'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { OfficialLifeCard, OfficialLifeId } from '../../contracts/official-lives.ts';
import {
  OfficialLifeCommands,
  OfficialLivesClient,
  OfficialLivesFailure,
} from './official-lives-client.ts';
import styles from './official-lives.module.css';

export type OfficialLifeArtwork = 'garage' | 'lake' | 'house' | 'stage';
export interface OfficialLifeCardView {
  id: string;
  title: string;
  hook: string;
  artwork: OfficialLifeArtwork;
  hasSave: boolean;
  experienceNote?: string;
}

const artworkById: Record<OfficialLifeId, OfficialLifeArtwork> = {
  'county-yellow-hair': 'garage',
  'only-child': 'lake',
  'returned-daughter': 'house',
  'retired-star': 'stage',
};
const explain = (error: unknown) =>
  error instanceof OfficialLivesFailure ? error.message : '暂时无法打开，请保留这次操作再试。';

export function OfficialLives({ connectSession }: { connectSession?: () => Promise<void> }) {
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
  return (
    <OfficialLivesView
      cards={cards.map((card) => ({
        id: card.id,
        title: card.title,
        hook: card.hook,
        artwork: artworkById[card.id],
        hasSave: card.worldId !== null,
        experienceNote: card.experienceNote,
      }))}
      loading={loading}
      loadError={loadError}
      pendingId={pendingId}
      errors={errors}
      onOpen={(id) => {
        void open(id);
      }}
      onReload={() => {
        if (!sending.current) void load();
      }}
    />
  );
}

export function OfficialLivesView({
  cards,
  loading = false,
  loadError = '',
  pendingId = null,
  errors = {},
  onOpen,
  onReload,
}: {
  cards: readonly OfficialLifeCardView[];
  loading?: boolean;
  loadError?: string;
  pendingId?: string | null;
  errors?: Readonly<Record<string, string>>;
  onOpen: (id: string) => void;
  onReload: () => void;
}) {
  const headingId = useId();
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.introduction}>
        <span className={styles.eyebrow}>原创人生副本</span>
        <h2 id={headingId}>今天，换一种人生</h2>
        <p>选一部手机，走进已经开始的生活。</p>
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
}: {
  card: OfficialLifeCardView;
  pending: boolean;
  disabled: boolean;
  error: string;
  onOpen: (id: string) => void;
}) {
  const titleId = useId(),
    errorId = useId();
  const action = pending
    ? '正在准备这部手机…'
    : card.hasSave
      ? '继续'
      : error
        ? '重新尝试'
        : '打开这部手机';
  return (
    <article className={styles.card} aria-labelledby={titleId} aria-busy={pending}>
      <div className={`${styles.cover} ${styles[card.artwork]}`}>
        <OfficialLifeIllustration artwork={card.artwork} />
        <div className={styles.shade} />
        <span className={styles.artLabel}>原创插画</span>
        <div className={styles.copy}>
          <h3 id={titleId}>{card.title}</h3>
          <p>{card.hook}</p>
        </div>
      </div>
      <div className={styles.actions}>
        {error && (
          <p id={errorId} className={styles.error} role="alert">
            {error}
          </p>
        )}
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
        {card.experienceNote && (
          <details className={styles.experienceDetails}>
            <summary>体验说明</summary>
            <p className={styles.experienceNote}>{card.experienceNote}</p>
          </details>
        )}
      </div>
    </article>
  );
}

function OfficialLifeIllustration({ artwork }: { artwork: OfficialLifeArtwork }) {
  return (
    <svg
      className={styles.illustration}
      viewBox="0 0 400 228"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      {artwork === 'garage' && (
        <>
          <circle cx="309" cy="55" r="27" fill="#f5c078" />
          <path d="M0 125 70 93 120 108 172 82 229 117 300 102 400 123V228H0Z" fill="#514047" />
          <path d="M45 140V76H189V151H45Z" fill="#f2a163" />
          <path d="M37 76 117 50 200 76Z" fill="#3b3541" />
          <path d="M66 140V91H166V140Z" fill="#2b3342" />
          <path d="M73 94H158M73 103H158M73 112H158" stroke="#657183" strokeWidth="3" />
          <path d="M222 131 244 109H301L326 131 339 136V154H211V136Z" fill="#dfc4a0" />
          <path d="M250 112H297L315 130H235Z" fill="#343b50" />
          <circle cx="238" cy="155" r="13" fill="#292b38" />
          <circle cx="316" cy="155" r="13" fill="#292b38" />
          <path d="M352 63V152M343 72H366" stroke="#d4ae8c" strokeWidth="3" />
        </>
      )}
      {artwork === 'lake' && (
        <>
          <circle cx="301" cy="58" r="29" fill="#e9d9b3" />
          <path d="M0 98Q110 47 207 106T400 93V142H0Z" fill="#508187" />
          <path d="M0 126H400V228H0Z" fill="#39656f" />
          <path
            d="M0 173H400M0 192H400M46 145H140M267 148H354"
            stroke="#9dbcb5"
            strokeWidth="2"
            opacity=".65"
          />
          <path d="M0 200 107 151 281 151 400 200Z" fill="#d6c1a1" />
          <path
            d="M91 158V72M297 158V72M91 72Q194 111 297 72"
            stroke="#ded7b8"
            strokeWidth="3"
            fill="none"
          />
          {[113, 145, 177, 209, 241, 273].map((x, i) => (
            <circle key={x} cx={x} cy={82 + (2 - Math.abs(2 - i)) * 5} r="4" fill="#fff0c8" />
          ))}
          <path
            d="M152 169 149 122H172L175 169M233 169 231 122H254L256 169"
            stroke="#5b4d46"
            strokeWidth="6"
            fill="none"
          />
          <ellipse cx="204" cy="127" rx="34" ry="10" fill="#f4e4c8" />
        </>
      )}
      {artwork === 'house' && (
        <>
          <path d="M44 228V38H356V228Z" fill="#c9afaa" />
          <path d="M51 228V41H125V228M275 228V41H349V228" fill="#8d7883" />
          <path d="M143 228V68Q143 18 200 18T257 68V228Z" fill="#ead3b7" />
          <path d="M156 228V68Q156 32 200 32T244 68V228Z" fill="#786674" />
          <path d="M163 228V79Q163 45 200 45T237 79V228Z" fill="#d8b588" />
          <path d="M200 40V89M182 61H218" stroke="#4c3e53" strokeWidth="2" />
          <ellipse cx="200" cy="95" rx="22" ry="8" fill="#fce3aa" />
          <path d="M50 144H124M276 144H350" stroke="#ead3b7" strokeWidth="3" />
          <path d="M133 210H267M124 218H276M116 226H284" stroke="#f1d7bc" strokeWidth="5" />
        </>
      )}
      {artwork === 'stage' && (
        <>
          <path d="M76 0 17 200H186L110 0ZM290 0 221 200H391L324 0Z" fill="#b1bed3" opacity=".2" />
          <circle cx="303" cy="66" r="30" fill="#d1cfc6" opacity=".7" />
          <path d="M0 157Q75 123 143 160T288 151T400 163V228H0Z" fill="#4f7587" />
          <path d="M0 190Q100 163 178 189T400 182V228H0Z" fill="#254858" />
          <path d="M97 144V64M89 144H106" stroke="#d6c7b2" strokeWidth="3" />
          <rect
            x="87"
            y="48"
            width="20"
            height="38"
            rx="10"
            fill="#d6c7b2"
            transform="rotate(-18 97 67)"
          />
          <path d="M156 162H254L266 188H147Z" fill="#9b8d83" />
          <path d="M169 170H242M176 176H245" stroke="#cfc1a8" strokeWidth="2" />
        </>
      )}
    </svg>
  );
}
