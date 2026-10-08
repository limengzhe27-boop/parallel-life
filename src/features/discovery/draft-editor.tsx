'use client';
import { useRef, useState } from 'react';
import type { Profile } from '../../contracts/api.ts';
import { usableProfileFact } from '../../modules/profile/domain/profile-view.ts';
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
    [setup, setSetup] = useState(draft.setup),
    [selection, setSelection] = useState(() => ({
      ...draft.selection,
      assetIds: [
        ...new Set([
          ...draft.selection.assetIds,
          ...initialProfile.people
            .filter((p) => draft.selection.personIds.includes(p.id))
            .flatMap((p) => (p.assetId ? [p.assetId] : [])),
        ]),
      ],
    }));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const saveRequest = useRef<SaveDraft | null>(null),
    confirmRequest = useRef<ConfirmDraft | null>(null);
  const confirmed = current.status === 'confirmed';
  const dirty =
    JSON.stringify(story) !== JSON.stringify(current.story) ||
    JSON.stringify(setup) !== JSON.stringify(current.setup) ||
    JSON.stringify(selection) !== JSON.stringify(current.selection) ||
    profile.version !== current.profileVersion;
  const ownPhotos = [
    ...new Set(
      [profile.portraitAssetId, ...profile.referenceAssetIds].filter((id): id is string => !!id),
    ),
  ];
  const pictures = ownPhotos;
  function close() {
    if (!busy && (!dirty || confirmed || window.confirm('更改还没有保存，仍要离开吗？'))) onClose();
  }
  async function save() {
    if (!dirty) return current;
    const fields = {
      expectedVersion: current.version,
      expectedProfileVersion: profile.version,
      story,
      setup,
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
          <label>
            <span>这段人生</span>
            <input
              value={story.title}
              maxLength={60}
              onChange={(e) => setStory({ ...story, title: e.target.value })}
            />
          </label>
          <label>
            <span>你在这里是谁</span>
            <input
              value={setup.identity}
              maxLength={80}
              placeholder="比如，正在筹拍第一部电影的导演"
              onChange={(e) => setSetup({ ...setup, identity: e.target.value })}
            />
          </label>
          {(['premise', 'opening', 'tradeoff'] as const).map((key) => (
            <label key={key}>
              <span>
                {
                  {
                    premise: '改变哪次选择',
                    opening: '故事从这里开始',
                    tradeoff: '这条路的另一面',
                  }[key]
                }
              </span>
              <textarea
                rows={key === 'opening' ? 3 : 2}
                value={story[key]}
                maxLength={key === 'opening' ? 400 : key === 'premise' ? 300 : 200}
                onChange={(e) => setStory({ ...story, [key]: e.target.value })}
              />
            </label>
          ))}
          <details className={s.setup}>
            <summary>地点与生活氛围（选填）</summary>
            <label>
              <span>故事发生在哪里</span>
              <input
                value={setup.place}
                maxLength={120}
                placeholder="一座城市，或一条熟悉的街"
                onChange={(e) => setSetup({ ...setup, place: e.target.value })}
              />
            </label>
            <label>
              <span>你希望是什么感觉</span>
              <input
                value={setup.tone}
                maxLength={100}
                placeholder="比如，热闹但不总是顺利"
                onChange={(e) => setSetup({ ...setup, tone: e.target.value })}
              />
            </label>
          </details>
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
                  personRoles: [],
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
                .filter((f) => usableProfileFact(profile, f) !== null)
                .map((f) => (
                  <label className={s.choice} key={f.id}>
                    <input
                      type="checkbox"
                      checked={selection.factIds.includes(f.id)}
                      onChange={() =>
                        setSelection({ ...selection, factIds: toggle(selection.factIds, f.id) })
                      }
                    />
                    <span>{usableProfileFact(profile, f)?.value}</span>
                  </label>
                ))}
              {!profile.facts.some((f) => usableProfileFact(profile, f) !== null) && (
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
              <summary>我身边的人 · 已选 {selection.personIds.length}</summary>
              <p className={s.hint}>
                选填，最多8位。选中人物时，其关联原图会同时出现在角色头像和相册中。普通头像也可以，不会用于推断长相。
              </p>
              {profile.people.map((p) => (
                <div key={p.id} className={s.person}>
                  <label className={s.choice}>
                    <input
                      type="checkbox"
                      checked={selection.personIds.includes(p.id)}
                      disabled={
                        !selection.personIds.includes(p.id) && selection.personIds.length >= 8
                      }
                      onChange={() => {
                        const personIds = toggle(selection.personIds, p.id);
                        const personPhotos = profile.people
                          .filter((p) => personIds.includes(p.id))
                          .flatMap((p) => (p.assetId ? [p.assetId] : []));
                        setSelection({
                          ...selection,
                          personIds,
                          personRoles: (selection.personRoles ?? []).filter((r) =>
                            personIds.includes(r.personId),
                          ),
                          assetIds: [
                            ...new Set([
                              ...selection.assetIds.filter((id) => ownPhotos.includes(id)),
                              ...personPhotos,
                            ]),
                          ],
                        });
                      }}
                    />
                    {p.assetId && (
                      <img
                        className={s.personAvatar}
                        src={`/api/v1/assets/${p.assetId}`}
                        alt={`${p.name}的原图`}
                      />
                    )}
                    <span>
                      {p.name}
                      <small>现实关系：{p.relationship}</small>
                    </span>
                  </label>
                  {selection.personIds.includes(p.id) && (
                    <label className={s.personRole}>
                      <span>在这段人生里，他是谁（选填）</span>
                      <input
                        aria-label={`${p.name}的分支角色`}
                        maxLength={160}
                        placeholder="比如，让现实中的老板成为我的下属"
                        value={selection.personRoles?.find((r) => r.personId === p.id)?.role ?? ''}
                        onChange={(e) =>
                          setSelection({
                            ...selection,
                            personRoles: [
                              ...(selection.personRoles ?? []).filter((r) => r.personId !== p.id),
                              ...(e.target.value.trim()
                                ? [{ personId: p.id, role: e.target.value }]
                                : []),
                            ],
                          })
                        }
                      />
                      <small className={s.hint}>
                        留空则由故事安排虚构角色，不会改变现实人物资料。
                      </small>
                    </label>
                  )}
                </div>
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
                        disabled={profile.people.some(
                          (p) => selection.personIds.includes(p.id) && p.assetId === id,
                        )}
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
                <p className={s.hint}>还没有可选的本人照片。人物原图随选中的人物一起带入。</p>
              )}
            </details>
          </fieldset>
        )}
        {confirmed && (
          <div className={s.hint}>
            {setup.identity && <p>你是：{setup.identity}</p>}
            {setup.place && <p>地点：{setup.place}</p>}
            {setup.tone && <p>氛围：{setup.tone}</p>}
            <p>
              已带入 {selection.factIds.length} 条资料、{selection.eventIds.length} 段经历、
              {selection.personIds.length} 位人物、{selection.assetIds.length} 张照片。
            </p>
          </div>
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
