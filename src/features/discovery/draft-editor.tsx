'use client';
import { useRef, useState } from 'react';
import type { Profile } from '../../contracts/api.ts';
import type { LifeDraft, SaveDraft, ConfirmDraft } from '../../contracts/life-drafts.ts';
import { Button, Modal, Notice } from '../../components/ui.tsx';
import { ApiFailure, type LifeClient } from '../api/client.ts';
import s from './draft-editor.module.css';
const toggle = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
export function DraftEditor({
  draft,
  profile: initialProfile,
  client,
  onClose,
  onConfirmed,
  onSaved,
}: {
  draft: LifeDraft;
  profile: Profile;
  client: LifeClient;
  onClose: () => void;
  onConfirmed: (draft: LifeDraft) => void;
  onSaved?: () => void;
}) {
  const [current, setCurrent] = useState(draft),
    [profile, setProfile] = useState(initialProfile);
  const [story, setStory] = useState(draft.story),
    [selection, setSelection] = useState(draft.selection);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const saveRequest = useRef<SaveDraft | null>(null),
    confirmRequest = useRef<ConfirmDraft | null>(null);
  const confirmed = current.status === 'confirmed';
  const dirty =
    JSON.stringify(story) !== JSON.stringify(current.story) ||
    JSON.stringify(selection) !== JSON.stringify(current.selection) ||
    profile.version !== current.profileVersion;
  const ownPhotos = [
    ...new Set(
      [profile.portraitAssetId, ...profile.referenceAssetIds].filter((id): id is string => !!id),
    ),
  ];
  const pictures = [
    ...new Set([
      ...ownPhotos,
      ...profile.people
        .filter((p) => selection.personIds.includes(p.id))
        .map((p) => p.assetId)
        .filter((id): id is string => !!id),
    ]),
  ];
  function close() {
    if (!busy && (!dirty || confirmed || window.confirm('更改还没有保存，仍要离开吗？'))) onClose();
  }
  async function save() {
    if (!dirty) return current;
    const fields = {
      expectedVersion: current.version,
      expectedProfileVersion: profile.version,
      story,
      selection,
    };
    if (
      !saveRequest.current ||
      JSON.stringify({ ...saveRequest.current, commandId: undefined }) !== JSON.stringify(fields)
    )
      saveRequest.current = { ...fields, commandId: crypto.randomUUID() };
    const next = await client.saveDraft(current.id, saveRequest.current);
    setCurrent(next);
    setSaved(true);
    saveRequest.current = null;
    onSaved?.();
    return next;
  }
  async function act(confirm: boolean) {
    setBusy(true);
    setError('');
    try {
      if (confirmed) {
        onConfirmed(current);
        return;
      }
      const next = await save();
      if (confirm) {
        if (!confirmRequest.current || confirmRequest.current.expectedVersion !== next.version)
          confirmRequest.current = {
            commandId: crypto.randomUUID(),
            expectedVersion: next.version,
            expectedProfileVersion: next.profileVersion,
          };
        const result = await client.confirmDraft(next.id, confirmRequest.current);
        setCurrent(result);
        onSaved?.();
        onConfirmed(result);
      }
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : '暂时没有保存成功，你的修改还在这里。');
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    setBusy(true);
    setError('');
    try {
      const [latest, workspace] = await Promise.all([client.draft(current.id), client.workspace()]);
      if (latest.version !== current.version) {
        setError('草案已在另一处修改。请先保留这里的文字，再关闭并重新打开最新草案。');
        return;
      }
      setProfile(workspace.profile);
      setError('已读取最新资料。请重新核对带入内容，再保存或确认。');
    } catch {
      setError('未能读取最新资料，请稍后再试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={confirmed ? '人生起点' : '这一次，你想怎样生活'}
      className={s.dialog}
      onClose={close}
    >
      <div className={s.editor}>
        <p className={s.status} role="status">
          {confirmed
            ? '设定已确认，继续准备你的手机。'
            : dirty
              ? '有未保存的修改'
              : saved
                ? '草案已保存，随时可以回来继续。'
                : '已保存为草案，确认前不会创建世界。'}
        </p>
        <fieldset disabled={busy || confirmed} className={s.fields}>
          {(['title', 'premise', 'opening', 'tradeoff'] as const).map((key) => (
            <label key={key}>
              <span>
                {
                  {
                    title: '这段人生',
                    premise: '改变哪次选择',
                    opening: '故事从这里开始',
                    tradeoff: '这条路的另一面',
                  }[key]
                }
              </span>
              {key === 'title' ? (
                <input
                  value={story[key]}
                  maxLength={60}
                  onChange={(e) => setStory({ ...story, [key]: e.target.value })}
                />
              ) : (
                <textarea
                  rows={key === 'opening' ? 3 : 2}
                  value={story[key]}
                  maxLength={key === 'opening' ? 400 : key === 'premise' ? 300 : 200}
                  onChange={(e) => setStory({ ...story, [key]: e.target.value })}
                />
              )}
            </label>
          ))}
        </fieldset>
        {!confirmed && (
          <fieldset disabled={busy} className={s.fields}>
            <legend>带入哪些真实资料</legend>
            <Button
              variant="ghost"
              onClick={() =>
                setSelection({
                  factIds: [],
                  eventIds: [],
                  personIds: [],
                  assetIds: [],
                  portraitAssetId: null,
                })
              }
            >
              清空选择
            </Button>
            <p className={s.hint}>不选也可以，故事设定与现实档案分开保存。</p>
            <details>
              <summary>关于你 · 已选 {selection.factIds.length}</summary>
              {profile.facts
                .filter((f) => f.status === 'confirmed')
                .map((f) => (
                  <label className={s.choice} key={f.id}>
                    <input
                      type="checkbox"
                      checked={selection.factIds.includes(f.id)}
                      onChange={() =>
                        setSelection({ ...selection, factIds: toggle(selection.factIds, f.id) })
                      }
                    />
                    <span>{f.value}</span>
                  </label>
                ))}
              {!profile.facts.some((f) => f.status === 'confirmed') && (
                <p className={s.hint}>还没有可带入的资料。</p>
              )}
            </details>
            <details>
              <summary>经历 · 已选 {selection.eventIds.length}</summary>
              {profile.events.map((e) => (
                <label className={s.choice} key={e.id}>
                  <input
                    type="checkbox"
                    checked={selection.eventIds.includes(e.id)}
                    onChange={() =>
                      setSelection({ ...selection, eventIds: toggle(selection.eventIds, e.id) })
                    }
                  />
                  <span>
                    {e.title}
                    {e.date && <small>{e.date}</small>}
                  </span>
                </label>
              ))}
              {!profile.events.length && <p className={s.hint}>还没有记录经历。</p>}
            </details>
            <details>
              <summary>重要的人 · 已选 {selection.personIds.length}</summary>
              {profile.people.map((p) => (
                <label className={s.choice} key={p.id}>
                  <input
                    type="checkbox"
                    checked={selection.personIds.includes(p.id)}
                    onChange={() => {
                      const personIds = toggle(selection.personIds, p.id);
                      const allowed = new Set([
                        ...ownPhotos,
                        ...profile.people
                          .filter((p) => personIds.includes(p.id))
                          .map((p) => p.assetId),
                      ]);
                      setSelection({
                        ...selection,
                        personIds,
                        assetIds: selection.assetIds.filter((id) => allowed.has(id)),
                      });
                    }}
                  />
                  <span>
                    {p.name}
                    <small>{p.relationship}</small>
                  </span>
                </label>
              ))}
              {!profile.people.length && <p className={s.hint}>还没有记录人物。</p>}
            </details>
            <details>
              <summary>照片 · 已选 {selection.assetIds.length}</summary>
              <div className={s.photos}>
                {pictures.map((id, i) => (
                  <label className={s.picture} key={id}>
                    <img src={`/api/v1/assets/${id}`} alt={`可带入的照片 ${i + 1}`} />
                    <span>
                      <input
                        aria-label={`带入照片 ${i + 1}`}
                        type="checkbox"
                        checked={selection.assetIds.includes(id)}
                        onChange={() => {
                          const assetIds = toggle(selection.assetIds, id);
                          setSelection({
                            ...selection,
                            assetIds,
                            portraitAssetId: assetIds.includes(profile.portraitAssetId ?? '')
                              ? profile.portraitAssetId
                              : null,
                          });
                        }}
                      />
                      带入这张
                    </span>
                  </label>
                ))}
              </div>
              {!pictures.length && (
                <p className={s.hint}>还没有可选照片。选中人物后，可以单独选择他的照片。</p>
              )}
            </details>
          </fieldset>
        )}
        {confirmed && (
          <p className={s.hint}>
            已带入 {selection.factIds.length} 条资料、{selection.eventIds.length} 段经历、
            {selection.personIds.length} 位人物、{selection.assetIds.length} 张照片。
          </p>
        )}
        {error && (
          <Notice>
            {error}
            <Button variant="ghost" disabled={busy} onClick={() => void reload()}>
              读取最新资料
            </Button>
          </Notice>
        )}
        <div className={s.actions}>
          {!confirmed && (
            <Button variant="secondary" disabled={busy || !dirty} onClick={() => void act(false)}>
              保存草案
            </Button>
          )}
          <Button
            disabled={busy || Object.values(story).some((v) => !v.trim())}
            onClick={() => void act(true)}
          >
            {busy ? '正在保存…' : confirmed ? '继续准备手机' : '确认并准备手机'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
