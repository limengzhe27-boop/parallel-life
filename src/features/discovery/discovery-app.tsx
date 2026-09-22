'use client';
import { AppViewport } from '../../components/app-viewport.tsx';
import type { ApprovedSeed } from '../../contracts/seeds.ts';
import { SeedConsent, SeedReceipt } from './seed-consent.tsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Icon, Modal, Notice } from '../../components/ui.tsx';
import { LifeClient, ApiFailure } from '../api/client.ts';
import type { Profile } from '../../contracts/api.ts';
import type { Discovery, DiscoverRequest, LifeDirection } from '../../contracts/discovery.ts';
const explain = (error: unknown) =>
  error instanceof ApiFailure ? error.message : '暂时没有完成，你的想法仍保留在这里。';
export function DiscoveryApp() {
  const [client] = useState(() => new LifeClient()),
    [data, setData] = useState<Discovery | null>(null),
    [profile, setProfile] = useState<Profile | null>(null),
    [brief, setBrief] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [refining, setRefining] = useState<LifeDirection | null>(null),
    [refineText, setRefineText] = useState('');
  const [choosing, setChoosing] = useState<LifeDirection | null>(null),
    [seed, setSeed] = useState<ApprovedSeed | null>(null),
    [receipt, setReceipt] = useState(false);
  const pending = useRef<DiscoverRequest | null>(null),
    hydrated = useRef(false),
    retry = useRef<{ id: string; commandId: string } | null>(null);
  const load = useCallback(async () => {
    const [d, w, seeds] = await Promise.all([
      client.discovery(),
      client.workspace(),
      client.seeds(),
    ]);
    setSeed((current) =>
      !current || !seeds[0] || seeds[0].createdAt >= current.createdAt
        ? (seeds[0] ?? null)
        : current,
    );
    setData((current) => (!current || d.version >= current.version ? d : current));
    setProfile((current) =>
      !current || w.profile.version >= current.version ? w.profile : current,
    );
    if (!hydrated.current) {
      setBrief(d.brief);
      hydrated.current = true;
    }
  }, [client]);
  useEffect(() => {
    void load().catch((e) => setError(explain(e)));
  }, [load]);
  useEffect(() => {
    if (!data?.directions.length) return;
    const id = new URLSearchParams(location.search).get('direction');
    if (id && data.directions.some((d) => d.id === id))
      document.getElementById(`direction-${id}`)?.scrollIntoView({ block: 'start' });
  }, [data?.version]);
  const task = data?.activeTask,
    waiting = task?.status === 'queued' || task?.status === 'running';
  useEffect(() => {
    if (!waiting) return;
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await load();
      } catch (e) {
        if (live) setError(explain(e));
      }
      if (live) timer = setTimeout(poll, document.hidden ? 8000 : 2200);
    };
    timer = setTimeout(poll, 1600);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [waiting, task?.id, load]);
  async function generate(text: string, basedOnId: string | null = null) {
    if (!data || !profile || busy || waiting) return false;
    setBusy(true);
    setError('');
    const fields = {
      expectedVersion: data.version,
      expectedProfileVersion: profile.version,
      brief: text.trim(),
      basedOnId,
    };
    const old = pending.current;
    const request =
      old &&
      old.brief === fields.brief &&
      old.basedOnId === basedOnId &&
      old.expectedVersion === fields.expectedVersion &&
      old.expectedProfileVersion === fields.expectedProfileVersion
        ? old
        : { ...fields, commandId: crypto.randomUUID() };
    pending.current = request;
    try {
      const task = await client.discover(request);
      setData((current) => (current ? { ...current, activeTask: task } : current));
      pending.current = null;
      return true;
    } catch (e) {
      setError(explain(e));
      if (e instanceof ApiFailure && e.code === 'VERSION_CONFLICT') {
        pending.current = null;
        await load().catch(() => {});
      }
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function confirm(id: string) {
    if (!profile) return;
    setBusy(true);
    setError('');
    try {
      const p = await client.editProfile({
        expectedVersion: profile.version,
        operation: { kind: 'confirm-fact', id },
      });
      setProfile(p);
    } catch (e) {
      setError(explain(e));
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function taskAction(action: 'retry' | 'cancel') {
    if (!task) return;
    setBusy(true);
    setError('');
    try {
      if (action === 'cancel') await client.cancelTask(task.id);
      else {
        if (retry.current?.id !== task.id)
          retry.current = { id: task.id, commandId: crypto.randomUUID() };
        await client.retryTask(task.id, retry.current.commandId);
      }
      await load();
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  }
  const confirmed = profile?.facts.filter((f) => f.status === 'confirmed') ?? [],
    suggested = profile?.facts.filter((f) => f.status === 'suggested') ?? [],
    stale = !!data?.directions.length && data.profileVersion !== profile?.version;
  return (
    <div className="discovery-page">
      <header className="discovery-header">
        <a href="/" className="button ghost" aria-label="返回个人对话">
          <span className="back-chevron">
            <Icon name="chevron" size={20} />
          </span>
          回去聊聊
        </a>
        <a className="button ghost" href="/#profile">
          <Icon name="user" size={19} />
          我的故事
        </a>
      </header>
      <main className="discovery-main">
        <section className="discovery-intro page-enter">
          <p className="eyebrow">从我们的对话继续</p>
          <h1>
            这段人生，
            <br />
            由你来决定。
          </h1>
          <p>想保留什么、改变什么，都可以继续聊。</p>
          <img
            className="discovery-illustration"
            src="/art/open-door.webp"
            alt="通向另一种可能的门，通用插画"
          />
        </section>
        {error && (
          <Notice>
            {error}
            {!data && (
              <Button
                variant="ghost"
                onClick={() => void load().catch((e) => setError(explain(e)))}
              >
                重新连接
              </Button>
            )}
          </Notice>
        )}
        {!data || !profile ? (
          <div className="discovery-loading">
            <span className="spinner" />
            正在翻开你的故事…
          </div>
        ) : (
          <>
            <details className="discovery-basis" open={confirmed.length === 0}>
              <summary>
                <span>
                  <Icon name="book" size={16} />
                  从这些小事想到你
                </span>
                <small>
                  {confirmed.length} 条已确认
                  {suggested.length ? ` · ${suggested.length} 条待确认` : ''}
                </small>
              </summary>
              <p>只使用你确认过的资料。也可以直接在下方写一个新的“如果”。</p>
              <div className="basis-facts">
                {confirmed.slice(-24).map((f) => (
                  <span className="basis-chip" key={f.id}>
                    <Icon name="check" size={13} />
                    {f.value}
                  </span>
                ))}
              </div>
              {suggested.length > 0 && (
                <div className="basis-suggestions">
                  {suggested.map((f) => (
                    <div key={f.id}>
                      <span>{f.value}</span>
                      <Button
                        variant="ghost"
                        disabled={busy || waiting}
                        aria-label={`确认：${f.value}`}
                        onClick={() => void confirm(f.id)}
                      >
                        确认
                        <Icon name="check" size={14} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <a href="/#profile" className="text-link">
                修改我的资料
                <Icon name="edit" size={13} />
              </a>
            </details>
            {seed && (
              <section className="prepared-seed">
                <Icon name="check" size={20} />
                <div>
                  <small>已经记下的想法</small>
                  <h2>{seed.story.title}</h2>
                  <p>设定已保存，世界还未生成。</p>
                </div>
                <Button variant="secondary" onClick={() => setReceipt(true)}>
                  打开看看
                </Button>
              </section>
            )}
            {stale && (
              <Notice tone="info">
                你的资料有了更新。下面保留着上一次的构想，可以按新资料再想一组。
              </Notice>
            )}
            {waiting && (
              <div className="discovery-progress" role="status">
                <div className="thinking-dots">
                  <i />
                  <i />
                  <i />
                </div>
                <div>
                  <strong>
                    {task?.status === 'queued' ? '你的想法已记下' : '正在寻找与你有关的可能'}
                  </strong>
                  <p>
                    {task?.status === 'queued'
                      ? '轮到你时，会继续构想这段人生。'
                      : '我们在想象不同的选择，也想想它们各自的取舍。'}
                    关掉页面也不会丢失。
                  </p>
                </div>
                <Button variant="ghost" disabled={busy} onClick={() => void taskAction('cancel')}>
                  暂停
                </Button>
              </div>
            )}
            {task && ['failed', 'unknown', 'cancelled', 'conflict'].includes(task.status) && (
              <Notice tone="info">
                <span>
                  {task.status === 'conflict'
                    ? '资料已经变化，这次结果没有覆盖原来的方向。请用最新资料重新构想。'
                    : task.status === 'cancelled'
                      ? '这次构想已暂停。你的想法和之前的方向仍然保留。'
                      : '这次构想没有完整返回。原来的方向仍在，可以再试一次。'}
                </span>
                {task.status !== 'conflict' && (
                  <Button variant="ghost" disabled={busy} onClick={() => void taskAction('retry')}>
                    重新构想
                    <Icon name="refresh" size={16} />
                  </Button>
                )}
              </Notice>
            )}
            {data.directions.length ? (
              <section className="direction-grid" aria-label="为你构想的人生方向">
                {data.directions.map((direction, index) => (
                  <article
                    id={`direction-${direction.id}`}
                    className="direction-card page-enter"
                    key={direction.id}
                  >
                    <div className="direction-cover">
                      <img
                        loading="lazy"
                        src={index === 1 ? '/art/open-door.webp' : '/art/meadow-door.webp'}
                        alt="另一种可能的通用想象插画"
                      />
                      <small>想象插画</small>
                    </div>
                    <div className="direction-card-top">
                      <span className="direction-number">可能 / 0{index + 1}</span>
                      <Icon name={(['spark', 'clock', 'chat'] as const)[index]!} size={22} />
                    </div>
                    <h2>{direction.title}</h2>
                    <p className="direction-premise">{direction.premise}</p>
                    <details className="direction-scene">
                      <summary>
                        想象这样的一天 <Icon name="plus" size={14} />
                      </summary>
                      <p>{direction.premise}</p>
                      <p>{direction.opening}</p>
                    </details>
                    <details className="direction-details">
                      <summary>
                        为什么想到它
                        <Icon name="plus" size={14} />
                      </summary>
                      <p>{direction.reason}</p>
                      <ul>
                        {direction.sources.map((source) => (
                          <li key={source.factId}>{source.value}</li>
                        ))}
                      </ul>
                      {!direction.sources.length && <small>来自你这次写下的“如果”</small>}
                      <h3>这条路，也有另一面</h3>
                      <p>{direction.tradeoff}</p>
                    </details>
                    <Button
                      className="direction-select"
                      disabled={busy || waiting || stale}
                      onClick={() => setChoosing(direction)}
                    >
                      试试这条人生
                      <Icon name="arrow" size={16} />
                    </Button>
                    <Button
                      className="direction-refine"
                      variant="secondary"
                      disabled={busy || waiting || stale}
                      onClick={() => {
                        setRefining(direction);
                        setRefineText('');
                        setError('');
                      }}
                    >
                      我想改一点
                      <Icon name="edit" size={15} />
                    </Button>
                  </article>
                ))}
              </section>
            ) : (
              !waiting && (
                <div className="discovery-empty">
                  <Icon name="spark" size={28} />
                  <h2>下一个故事，由你开头。</h2>
                  <p>
                    {confirmed.length
                      ? '你的资料已经准备好，可以看看不同选择会打开怎样的生活。'
                      : '确认一条与你有关的资料，或者说说想体验什么。'}
                  </p>
                </div>
              )
            )}
            <form
              className="discovery-compose"
              onSubmit={(e) => {
                e.preventDefault();
                void generate(brief);
              }}
            >
              <label htmlFor="what-if">
                {data.directions.length ? '还有别的想法吗？' : '写下你的“如果”'}
                <small>也可以不填，从你聊过的事里找灵感</small>
              </label>
              <textarea
                id="what-if"
                className="field"
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                maxLength={1500}
                rows={3}
                placeholder="假如当时做了另一个选择，或者现在开始一直想做的事…"
              />
              <div>
                <span>
                  <Icon name="lock" size={13} />
                  这段故事，先只写给你
                </span>
                <Button
                  type="submit"
                  disabled={busy || waiting || (!confirmed.length && !brief.trim())}
                >
                  {busy ? <span className="spinner" /> : <Icon name="spark" size={17} />}{' '}
                  {data.directions.length ? '换一组想法' : '帮我想想'}
                  <Icon name="arrow" size={17} />
                </Button>
              </div>
            </form>
            <p className="discovery-footnote">这里是人生构想。保存想法后，世界体验还在准备中。</p>
          </>
        )}
      </main>
      <AppViewport />
      {choosing && profile && data && (
        <SeedConsent
          direction={choosing}
          profile={profile}
          discovery={data}
          client={client}
          onClose={() => setChoosing(null)}
          onSaved={(saved) => {
            setSeed(saved);
            setReceipt(true);
          }}
        />
      )}
      {receipt && seed && <SeedReceipt seed={seed} onClose={() => setReceipt(false)} />}
      {refining && (
        <Modal
          open
          title="让这条人生，更像你想要的"
          onClose={() => {
            if (!busy) setRefining(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void generate(refineText, refining.id).then((ok) => {
                if (ok) setRefining(null);
              });
            }}
          >
            <div className="refine-context">
              <span>围绕这个方向</span>
              <h3>{refining.title}</h3>
              <p>{refining.premise}</p>
            </div>
            <label className="form-label">
              想保留什么，又想改变什么？
              <textarea
                autoFocus
                className="field"
                value={refineText}
                onChange={(e) => setRefineText(e.target.value)}
                rows={4}
                maxLength={1500}
                placeholder="我喜欢这个方向，不过我希望…"
              />
            </label>
            {error && <Notice>{error}</Notice>}
            <div className="form-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setRefining(null)}
              >
                再想想
              </Button>
              <Button type="submit" disabled={busy || !refineText.trim()}>
                按这个想法调整
                <Icon name="arrow" size={16} />
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
