'use client';
import { DraftEditor } from './draft-editor.tsx';
import type { LifeDraft } from '../../contracts/life-drafts.ts';
import { BranchList } from './branch-list.tsx';
import { BuildControl } from './build-control.tsx';
import type { WorldBuild } from '../../contracts/world-build.ts';
import { AppTabs } from '../../components/app-tabs.tsx';
import { AppViewport } from '../../components/app-viewport.tsx';
import type { ApprovedSeed } from '../../contracts/seeds.ts';
import { SeedReceipt } from './seed-consent.tsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Icon, Modal, Notice } from '../../components/ui.tsx';
import { LifeClient, ApiFailure } from '../api/client.ts';
import { buildBranchBrief } from '../interview/branch-intent.ts';
import type { Profile } from '../../contracts/api.ts';
import type { Discovery, DiscoverRequest, LifeDirection } from '../../contracts/discovery.ts';
const explain = (error: unknown) =>
  error instanceof ApiFailure ? error.message : '暂时没有完成，你的想法仍保留在这里。';
export function DiscoveryApp() {
  const [proposalOpen, setProposalOpen] = useState(false);
  const [client] = useState(() => new LifeClient()),
    [data, setData] = useState<Discovery | null>(null),
    [profile, setProfile] = useState<Profile | null>(null),
    [brief, setBrief] = useState(''),
    [recentConversation, setRecentConversation] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [refining, setRefining] = useState<LifeDirection | null>(null),
    [refineText, setRefineText] = useState('');
  const [choosing, setChoosing] = useState<LifeDraft | null>(null),
    [seed, setSeed] = useState<ApprovedSeed | null>(null),
    [savedSeeds, setSavedSeeds] = useState<ApprovedSeed[]>([]),
    [receipt, setReceipt] = useState(false);
  const [drafts, setDrafts] = useState<LifeDraft[]>([]);
  const [builds, setBuilds] = useState<WorldBuild[]>([]);
  const pending = useRef<DiscoverRequest | null>(null),
    hydrated = useRef(false),
    retry = useRef<{ id: string; commandId: string } | null>(null);
  const load = useCallback(async () => {
    const [d, w, seeds, worldBuilds, drafts] = await Promise.all([
      client.discovery(),
      client.workspace(),
      client.seeds(),
      client.builds(),
      client.drafts(),
    ]);
    setSavedSeeds(seeds);
    setDrafts(drafts);
    setBuilds(worldBuilds);
    setRecentConversation(buildBranchBrief(w.interview.messages));
    setData((current) => (!current || d.version >= current.version ? d : current));
    setProfile((current) =>
      !current || w.profile.version >= current.version ? w.profile : current,
    );
    if (!hydrated.current) {
      setBrief(d.brief);
      if (d.directions.length && !seeds.length) setProposalOpen(true);
      hydrated.current = true;
    }
  }, [client]);
  useEffect(() => {
    void load().catch((e) => setError(explain(e)));
  }, [load]);
  useEffect(() => {
    if (!data?.directions.length) return;
    const id = new URLSearchParams(location.search).get('direction');
    if (id) setProposalOpen(true);
    if (id && data.directions.some((d) => d.id === id))
      document.getElementById(`direction-${id}`)?.scrollIntoView({ block: 'start' });
  }, [data?.version]);
  const building = builds.some((b) => b.task?.status === 'queued' || b.task?.status === 'running');
  useEffect(() => {
    if (!building) return;
    const timer = setInterval(() => {
      void load().catch((e) => setError(explain(e)));
    }, 2500);
    return () => clearInterval(timer);
  }, [building, load]);
  const task = data?.activeTask,
    waiting = task?.status === 'queued' || task?.status === 'running';
  useEffect(() => {
    if (!waiting || !task?.id) return;
    let live = true;
    // 立即执行大模型分支推演，完成后自动刷新加载分支结果
    void client
      .task(task.id)
      .then(() => {
        if (live) void load();
      })
      .catch((e) => {
        if (live) setError(explain(e));
      });
    const timer = setInterval(() => {
      if (live) void load().catch(() => {});
    }, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [waiting, task?.id, client, load]);
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
      // 只要用户发出生成分支命令，立刻触发模型推演并自动加载生成的分支
      void client
        .task(task.id)
        .then(() => load())
        .catch((e) => setError(explain(e)));
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

  async function enterWorldForSeed(saved: ApprovedSeed) {
    setBusy(true);
    setError('');
    try {
      const existing = builds.find((b) => b.seedId === saved.id);
      if (existing?.ready) {
        window.location.assign(`/worlds/${existing.worldId}`);
        return;
      }
      const build =
        existing ??
        (await client.createWorld({
          commandId: crypto.randomUUID(),
          seedId: saved.id,
        }));
      if (build.task?.id) {
        /* Continue only an attempt that is still queued or running. A failed or
           unknown attempt needs the user's explicit retry, because it may already
           have cost money — opening a page must never spend again. */
        const settled = await client.task(build.task.id);
        if (settled && settled.status !== 'succeeded') {
          setSeed(saved);
          setReceipt(true);
          await load();
          setBusy(false);
          setError('这段人生上一次没有生成成功，请选择重新生成。');
          return;
        }
      }
      window.location.assign(`/worlds/${build.worldId}`);
    } catch (e) {
      setSeed(saved);
      setReceipt(true);
      setError(explain(e));
      setBusy(false);
    }
  }

  async function reviewDirection(direction: LifeDirection) {
    if (!data || busy) return;
    setBusy(true);
    setError('');
    try {
      const draft = await client.prepareDraft({
        commandId: crypto.randomUUID(),
        directionId: direction.id,
        discoveryVersion: data.version,
      });
      const workspace = await client.workspace();
      setProfile(workspace.profile);
      setChoosing(draft);
      await load();
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  }
  async function resumeDraft(draft: LifeDraft) {
    setBusy(true);
    setError('');
    try {
      const [latest, workspace] = await Promise.all([client.draft(draft.id), client.workspace()]);
      setProfile(workspace.profile);
      setChoosing(latest);
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirmedDraft(draft: LifeDraft) {
    setChoosing(null);
    await load();
    if (!draft.seedId) return;
    const seed = await client.seed(draft.seedId);
    await enterWorldForSeed(seed);
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
    conversationBrief = recentConversation.length >= 5 ? recentConversation : '',
    stale = !!data?.directions.length && data.profileVersion !== profile?.version;
  const availableDirections = stale
    ? []
    : (data?.directions ?? []).filter(
        (direction) => !savedSeeds.some((saved) => saved.directionId === direction.id),
      );
  const showProposalDrawer =
    availableDirections.length > 0 ||
    waiting ||
    (!!task && ['failed', 'unknown', 'cancelled', 'conflict'].includes(task.status)) ||
    (savedSeeds.length === 0 && (confirmed.length > 0 || !!conversationBrief));
  return (
    <div className="discovery-page">
      <header className="discovery-header">
        <h1 className="outer-title">分支</h1>
        <a href="/" className="new-branch" aria-label="聊聊新的分支">
          <Icon name="plus" size={24} />
        </a>
      </header>
      <main className="discovery-main">
        {error && (
          <Notice>
            {error}
            {!data && (
              <Button
                variant="ghost"
                onClick={() => {
                  setError('');
                  void load().catch((e) => setError(explain(e)));
                }}
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
            <div className="branch-introduction">
              <h2>
                换一条路，
                <br />
                还是你。
              </h2>
              <p>
                {savedSeeds.length
                  ? '选一段人生，继续上次的故事。'
                  : '那些没走过的路，从一句「如果」开始。'}
              </p>
            </div>
            {savedSeeds.length === 0 &&
              data.directions.length === 0 &&
              !drafts.some((d) => d.status === 'draft') &&
              !waiting && (
                <div className="branch-empty">
                  <img src="/art/open-door.webp" alt="通向另一段生活的门，意境插画" />
                  {conversationBrief ? (
                    <>
                      <h2>从刚才聊到的事开始</h2>
                      <p>{conversationBrief.slice(0, 80)}</p>
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setProposalOpen(true);
                          void generate(conversationBrief);
                        }}
                      >
                        看看另一种可能 <Icon name="arrow" size={18} />
                      </Button>
                    </>
                  ) : (
                    <>
                      <h2>第一段故事，等你开口</h2>
                      <p>告诉我，你想试试怎样的生活。</p>
                      <a className="button primary" href="/">
                        聊一个如果 <Icon name="arrow" size={18} />
                      </a>
                    </>
                  )}
                </div>
              )}
            {drafts.some((d) => d.status === 'draft') && (
              <section aria-label="待继续的人生草案">
                <h2 style={{ fontSize: 18, margin: '20px 0 12px' }}>还在构思的人生</h2>
                <BranchList
                  disabled={busy}
                  items={drafts
                    .filter((d) => d.status === 'draft')
                    .map((d) => ({
                      id: d.id,
                      title: d.story.title,
                      description: d.story.premise,
                      status: '继续构思',
                    }))}
                  onOpen={(id) => {
                    const d = drafts.find((d) => d.id === id);
                    if (d) void resumeDraft(d);
                  }}
                />
              </section>
            )}
            {savedSeeds.length > 0 && (
              <BranchList
                disabled={busy}
                items={savedSeeds.map((saved) => ({
                  id: saved.id,
                  title: saved.story.title,
                  description: saved.story.opening || saved.story.premise,
                  ready: Boolean(builds.find((b) => b.seedId === saved.id)?.ready),
                  status: builds.find((b) => b.seedId === saved.id)?.ready ? '进入体验' : '待创建',
                  imageUrl: saved.portraitAssetId
                    ? `/api/v1/assets/${saved.portraitAssetId}`
                    : undefined,
                }))}
                onOpen={(id) => {
                  const saved = savedSeeds.find((s) => s.id === id);
                  if (!saved) return;
                  void enterWorldForSeed(saved);
                }}
              />
            )}
            {showProposalDrawer && (
              <details
                className="proposal-drawer"
                open={proposalOpen}
                onToggle={(e) => setProposalOpen(e.currentTarget.open)}
              >
                <summary>
                  {availableDirections.length ? '待决定的分支' : '聊出一条新路'}
                  <Icon name="chevron" size={16} />
                </summary>
                <details className="discovery-basis">
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
                        {task?.status === 'queued'
                          ? '正在构想平行人生分支…'
                          : '正在寻找与你有关的可能'}
                      </strong>
                      <p>正在为你推演不同的选择与走向，马上就好。关掉页面也不会丢失。</p>
                    </div>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void taskAction('cancel')}
                    >
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
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void taskAction('retry')}
                      >
                        重新构想
                        <Icon name="refresh" size={16} />
                      </Button>
                    )}
                  </Notice>
                )}
                {availableDirections.length ? (
                  <section className="direction-grid" aria-label="为你构想的人生方向">
                    {availableDirections.map((direction, index) => (
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
                          onClick={() => void reviewDirection(direction)}
                        >
                          {busy ? '正在准备草案…' : '构思这段人生'}
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
                    void generate(brief.trim() || conversationBrief);
                  }}
                >
                  <label htmlFor="what-if">
                    {availableDirections.length ? '还有别的想法吗？' : '写下你的“如果”'}
                    <small>
                      {conversationBrief
                        ? '留空就沿着刚才聊的事想'
                        : confirmed.length
                          ? '留空就从你确认过的经历出发'
                          : '说一句想试试的生活'}
                    </small>
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
                      disabled={
                        busy ||
                        waiting ||
                        (!confirmed.length && !brief.trim() && !conversationBrief)
                      }
                    >
                      {busy ? <span className="spinner" /> : <Icon name="spark" size={17} />}{' '}
                      {availableDirections.length ? '换一组想法' : '帮我想想'}
                      <Icon name="arrow" size={17} />
                    </Button>
                  </div>
                </form>
              </details>
            )}
          </>
        )}
      </main>
      <AppTabs active="possibilities" />
      <AppViewport />
      {choosing && profile && (
        <DraftEditor
          key={choosing.id}
          draft={choosing}
          profile={profile}
          client={client}
          onClose={() => {
            setChoosing(null);
            void load();
          }}
          onSaved={() => void load().catch((e) => setError(explain(e)))}
          onConfirmed={(d) => void confirmedDraft(d).catch((e) => setError(explain(e)))}
        />
      )}
      {receipt && seed && (
        <SeedReceipt
          seed={seed}
          ready={builds.some((b) => b.seedId === seed.id && b.ready)}
          onClose={() => setReceipt(false)}
        >
          <BuildControl
            seedId={seed.id}
            build={builds.find((b) => b.seedId === seed.id)}
            client={client}
            onChange={load}
          />
        </SeedReceipt>
      )}
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
