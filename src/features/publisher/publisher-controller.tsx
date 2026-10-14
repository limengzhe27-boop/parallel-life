'use client';
import { useEffect, useRef, useState } from 'react';
import { PublisherWorkbench } from './publisher-workbench.tsx';
import { PublisherClient, PublisherClientError } from './publisher-client.ts';
import type { PublisherSessionState } from '../../contracts/publisher-auth.ts';
import type {
  PublisherWork,
  PublisherCheckResult,
  PublisherWorkList,
} from '../../contracts/world-publisher.ts';
import {
  phoneTrialFromResult,
  phoneTrialMatches,
  phoneTrialMount,
  phoneTrialUrl,
  type PublisherPhoneTrial,
} from './publisher-phone-trial.ts';
import s from './publisher-controller.module.css';
import {
  PublisherTrialPreparation,
  PublisherTrialError,
  trialDraftChanged,
  type TrialAttempt,
} from './publisher-trial-preparation.ts';

export function PublisherController() {
  const [client] = useState(() => new PublisherClient());
  const [session, setSession] = useState<PublisherSessionState | null>(null);
  const [works, setWorks] = useState<PublisherWorkList['works']>([]);
  const [work, setWork] = useState<PublisherWork | null>(null);
  const workRef = useRef<PublisherWork | null>(work);
  workRef.current = work;
  const [draftSaving, setDraftSaving] = useState(false);
  const [trialMessage, setTrialMessage] = useState<string | null>(null);
  const queuedTrial = useRef<{
    workId: string;
    placement: 'inline' | 'drawer';
    draft?: { title: string; content: Record<string, unknown> };
  } | null>(null);
  const [trialPreparation] = useState(
    () =>
      new PublisherTrialPreparation(client, () => crypto.randomUUID(), {
        get(key) {
          try {
            const raw = sessionStorage.getItem('publisher-trial-preparation:' + key);
            if (!raw) return undefined;
            const value = JSON.parse(raw) as TrialAttempt;
            return typeof value.commandId === 'string' &&
              typeof value.workId === 'string' &&
              Number.isSafeInteger(value.draftVersion) &&
              typeof value.contentHash === 'string'
              ? value
              : undefined;
          } catch {
            return undefined;
          }
        },
        put(key, value) {
          try {
            sessionStorage.setItem('publisher-trial-preparation:' + key, JSON.stringify(value));
          } catch {
            /* The live coordinator still retains the original command. */
          }
        },
        remove(key) {
          try {
            sessionStorage.removeItem('publisher-trial-preparation:' + key);
          } catch {
            /* No storage permission; the live coordinator already retired this result. */
          }
        },
      }),
  );
  function updateWork(value: PublisherWork | null) {
    workRef.current = value;
    setWork(value);
  }
  const [phoneTrial, setPhoneTrial] = useState<PublisherPhoneTrial | null>(null);
  const phoneTrialRef = useRef<PublisherPhoneTrial | null>(phoneTrial);
  const phoneTrialMode = useRef<'character' | 'world' | null>(null);
  phoneTrialRef.current = phoneTrial;
  function updatePhoneTrial(value: PublisherPhoneTrial | null) {
    phoneTrialRef.current = value;
    setPhoneTrial(value);
  }
  const [trialPlacement, setTrialPlacement] = useState<'inline' | 'drawer' | null>(null);
  const trialMount = phoneTrialMount(work, phoneTrial, trialPlacement);
  const [check, setCheck] = useState<PublisherCheckResult | null>(null);
  const [busy, setBusy] = useState(true),
    running = useRef(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState('');
  function fail(e: unknown) {
    setTrialMessage(null);
    const f =
      e instanceof PublisherClientError || e instanceof PublisherTrialError
        ? e
        : new PublisherClientError('UNAVAILABLE');
    setError({ code: f.code, message: f.message });
  }
  async function loadWorks() {
    const list = await client.list();
    setWorks(list.works);
    return list.works;
  }
  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      fail(e);
    } finally {
      running.current = false;
      setBusy(false);
      const request = queuedTrial.current;
      queuedTrial.current = null;
      if (request && workRef.current?.id === request.workId)
        openTrial(request.placement, request.draft);
    }
  }
  function openTrial(
    placement: 'inline' | 'drawer',
    draftToSaveFirst?: { title: string; content: Record<string, unknown> },
  ) {
    const current = workRef.current;
    if (!current) return;
    if (running.current) {
      queuedTrial.current = { workId: current.id, placement, draft: draftToSaveFirst };
      setTrialMessage('正在保存修改，随后为你启动试演…');
      return;
    }
    void run(async () => {
      setTrialMessage(null);
      const draft = draftToSaveFirst ?? { title: current.title, content: current.draft.content };
      // Reopen the same actual saved trial without creating another draft revision or model call.
      let finalWork = current;
      const mode = placement === 'inline' ? 'character' : 'world';
      if (
        !phoneTrialMatches(current, phoneTrialRef.current) ||
        trialDraftChanged(current, draft) ||
        phoneTrialMode.current !== mode
      ) {
        const ready = await trialPreparation.open(current, draft, {
          onProgress: setTrialMessage,
          mode,
          onWork: (value) => {
            updateWork(value);
            setCheck(null);
          },
        });
        finalWork = ready.work;
        try {
          updatePhoneTrial(phoneTrialFromResult(finalWork, ready.result));
          phoneTrialMode.current = mode;
        } catch {
          throw new PublisherClientError('INVALID_STATE');
        }
        setTrialMessage(ready.supplemented ? '已为试演补齐所需内容，本次补充尚未发布。' : null);
        setCheck(null);
        await loadWorks();
      }
      setTrialPlacement(placement);
    });
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const state = await client.session();
        if (!alive) return;
        setSession(state);
        if (state.publisher) {
          const list = await client.list();
          if (!alive) return;
          setWorks(list.works);
          if (list.works[0]) {
            const value = await client.get(list.works[0].id);
            if (alive) updateWork(value);
          }
        }
      } catch (e) {
        if (alive) fail(e);
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [client]);
  if (!session?.publisher)
    return (
      <main className={s.gate}>
        <form
          className={s.card}
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const next = await client.login({ username, password });
              setPassword('');
              setSession(next);
              const list = await loadWorks();
              if (list[0]) updateWork(await client.get(list[0].id));
            });
          }}
        >
          <p className={s.eyebrow}>如果 · 内容后台</p>
          <h1>让一段人生可以被体验</h1>
          <p>内部创作者登录后，可以整理世界、人物和剧情，保存草稿并检查内容。</p>
          <label htmlFor="publisher-username">账号</label>
          <input
            id="publisher-username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
            required
          />
          <label htmlFor="publisher-password">密码</label>
          <input
            id="publisher-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />
          {error && (
            <p role="alert" className={s.error}>
              {error.message}
            </p>
          )}
          <button disabled={busy}>{busy ? '正在连接…' : '登录内容后台'}</button>
          <a href="/">返回用户体验</a>
        </form>
      </main>
    );
  return (
    <>
      <PublisherWorkbench
        preparationClient={client}
        session={{
          displayName: session.publisher.displayName,
          canEdit: session.publisher.permissions.includes('edit'),
          canPublish: session.publisher.permissions.includes('publish'),
        }}
        works={works}
        work={work}
        check={check}
        busy={busy}
        draftSaving={draftSaving}
        characterTrialMessage={trialMessage}
        characterTrialError={error?.message}
        error={error}
        onTrial={(draft) => openTrial('drawer', draft)}
        characterTrial={trialMount.inline}
        onCharacterTrial={(draft) => openTrial('inline', draft)}
        onCloseCharacterTrial={() => setTrialPlacement(null)}
        onPublish={() => {
          if (work && check)
            void run(async () => {
              await client.publish(work, check);
              updateWork(await client.get(work.id));
              setCheck(null);
              await loadWorks();
            });
        }}
        onSelectWork={(id) => {
          setTrialPlacement(null);
          setTrialMessage(null);
          void run(async () => {
            const next = await client.get(id);
            updateWork(next);
            setCheck(null);
          });
        }}
        onCreateWork={(draft) => {
          setTrialPlacement(null);
          void run(async () => {
            const next = await client.create(draft);
            updateWork(next);
            setCheck(null);
            await loadWorks();
          });
        }}
        onSaveDraft={(draft) => {
          if (work)
            void run(async () => {
              setDraftSaving(true);
              try {
                const current = workRef.current;
                if (!current || current.id !== work.id) return;
                const next = await client.save(current, draft);
                updateWork(next);
                setCheck(null);
                await loadWorks();
              } finally {
                setDraftSaving(false);
              }
            });
        }}
        onRenameWork={(workId, newTitle) => {
          void run(async () => {
            const next = await client.rename(workId, newTitle);
            if (work && work.id === workId) {
              updateWork(next);
            }
            await loadWorks();
          });
        }}
        onDeleteWork={(workId) => {
          void run(async () => {
            await client.delete(workId);
            setTrialPlacement(null);
            const remaining = await loadWorks();
            if (work && work.id === workId) {
              const first = remaining[0];
              if (first) {
                updateWork(await client.get(first.id));
              } else {
                updateWork(null);
              }
              setCheck(null);
            }
          });
        }}
        onCheck={() => {
          if (work)
            void run(async () => {
              setCheck(await client.check(work));
            });
        }}
        onLogout={() => {
          void run(async () => {
            setSession(await client.logout());
            setTrialPlacement(null);
            updatePhoneTrial(null);
            updateWork(null);
            setWorks([]);
            setCheck(null);
          });
        }}
      />
      {trialMount.drawer && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="独立试演"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(13,23,40,.4)',
            zIndex: 60,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <section
            style={{
              width: 'min(520px,100%)',
              background: 'white',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <header
              style={{
                padding: 12,
                color: '#172033',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <strong>独立试演</strong>
              <span>不会改变用户的存档</span>
              <button
                type="button"
                style={{ marginLeft: 'auto', minHeight: 44 }}
                onClick={() => setTrialPlacement(null)}
              >
                关闭试演
              </button>
            </header>
            <iframe
              title="这份草稿的真实试演手机"
              src={phoneTrialUrl(trialMount.drawer)}
              style={{ width: '100%', flex: 1, border: 0 }}
            />
          </section>
        </div>
      )}
    </>
  );
}
