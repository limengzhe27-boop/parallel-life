'use client';
import { useEffect, useRef, useState } from 'react';
import {
  ProfilePhotoRolesSchema,
  type ProfilePhotoRoles,
} from '../../contracts/profile-photo-roles.ts';
import type { Profile } from '../../contracts/api.ts';
import { usableProfileFact } from '../../modules/profile/domain/profile-view.ts';
import type { LifeDraft, SaveDraft, ConfirmDraft } from '../../contracts/life-drafts.ts';
import { Button, Modal, Notice } from '../../components/ui.tsx';
import { ApiFailure, type LifeClient } from '../api/client.ts';
import s from './draft-editor.module.css';
import { optionalDraftPhotos, synchronizeDraftPhotos } from './draft-photo-selection.ts';
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
    [selection, setSelection] = useState(draft.selection);
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
  const [roles, setRoles] = useState<ProfilePhotoRoles>();
  const verifiedRoles = useRef<ProfilePhotoRoles | undefined>(undefined);
  const [roleError, setRoleError] = useState('');
  const [roleRead, setRoleRead] = useState(0);
  useEffect(() => {
    if (confirmed) return;
    let live = true;
    setRoles(undefined);
    setRoleError('');
    const read = async () => {
      try {
        const r = await fetch('/api/v1/profile/photos/roles', {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!r.ok) throw new Error('照片用途暂时未能读取，请重新核对。');
        const next = ProfilePhotoRolesSchema.parse(await r.json());
        if (next.profileId !== profile.id || next.profileVersion !== profile.version)
          throw new Error('资料刚有更新，请读取最新资料后再确认。');
        if (!live) return;
        const previous = verifiedRoles.current;
        setRoles(next);
        setSelection((old) => synchronizeDraftPhotos(old, next, previous));
        verifiedRoles.current = next;
      } catch (e) {
        if (live) setRoleError(e instanceof Error ? e.message : '照片用途暂时未能读取。');
      }
    };
    void read();
    return () => {
      live = false;
    };
  }, [profile.id, profile.version, roleRead, confirmed]);
  const photosReady = roles?.profileId === profile.id && roles?.profileVersion === profile.version;
  const pictures = optionalDraftPhotos(roles);
  const optionalPhotoCount = selection.assetIds.filter((id) => pictures.includes(id)).length;
  function close() {
    if (!busy && (!dirty || confirmed || window.confirm('更改还没有保存，仍要离开吗？'))) onClose();
  }
  async function save() {
    if (!photosReady) throw new Error('请先核对照片用途。');
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
    setStory(next.story);
    setSetup(next.setup);
    setSelection(next.selection);
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
            ? '人生起点已确认，内容已保存。'
            : dirty
              ? '有未保存的修改'
              : saved
                ? '草案已保存，随时可以回来继续。'
                : '已保存为草案，确认前不会创建世界。'}
        </p>
        {confirmed ? (
          <section className={s.summary} aria-label="已确认的人生起点">
            <h3>{current.story.title}</h3>
            <dl>
              {(['premise', 'opening', 'tradeoff'] as const).map((key) => (
                <div key={key}>
                  <dt>
                    {
                      { premise: '改变的选择', opening: '故事开场', tradeoff: '这条路的另一面' }[
                        key
                      ]
                    }
                  </dt>
                  <dd>{current.story[key]}</dd>
                </div>
              ))}
              {current.setup.identity && (
                <div>
                  <dt>你的身份</dt>
                  <dd>{current.setup.identity}</dd>
                </div>
              )}
              {current.setup.place && (
                <div>
                  <dt>地点</dt>
                  <dd>{current.setup.place}</dd>
                </div>
              )}
              {current.setup.tone && (
                <div>
                  <dt>生活氛围</dt>
                  <dd>{current.setup.tone}</dd>
                </div>
              )}
            </dl>
            <p className={s.hint}>
              这个起点已确认，内容在这里只读。想尝试不同设定，可以回到分支页另写一段人生。
            </p>
          </section>
        ) : (
          <fieldset disabled={busy} className={s.fields}>
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
                placeholder="想体验的身份（选填）"
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
        )}
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
                选填，最多8位。有照片的朋友会默认带入照片，用于角色头像和相册；没有照片也可以选择。
              </p>
              {profile.people.map((p) => {
                const photo = roles?.personAssets.find((item) => item.personId === p.id);
                return (
                  <div key={p.id} className={s.person}>
                    <label className={s.choice}>
                      <input
                        type="checkbox"
                        checked={selection.personIds.includes(p.id)}
                        disabled={
                          !selection.personIds.includes(p.id) && selection.personIds.length >= 8
                        }
                        onChange={() => {
                          setSelection((old) => {
                            const personIds = toggle(old.personIds, p.id);
                            const next = {
                              ...old,
                              personIds,
                              personRoles: (old.personRoles ?? []).filter((r) =>
                                personIds.includes(r.personId),
                              ),
                            };
                            return roles ? synchronizeDraftPhotos(next, roles) : next;
                          });
                        }}
                      />
                      {photo && (
                        <img
                          className={s.personAvatar}
                          src={`/api/v1/assets/${photo.assetId}`}
                          alt={`${p.name}的原图`}
                        />
                      )}
                      <span>
                        {p.name}
                        <small>
                          {p.relationship === '照片人物'
                            ? '照片称呼，未说明现实关系'
                            : `现实关系：${p.relationship}`}
                        </small>
                        {p.interaction && (
                          <small>
                            我的描述：{p.interaction.slice(0, 600)}
                            {p.interaction.length > 600 && '…'}
                          </small>
                        )}
                        {!!p.experiences?.length && (
                          <small>
                            带入前 {Math.min(3, p.experiences.length)} 段共同经历作为背景
                          </small>
                        )}
                        {photo && <small>照片默认用于角色头像和相册</small>}
                      </span>
                    </label>
                    {selection.personIds.includes(p.id) && (
                      <label className={s.personRole}>
                        <span>在这段人生里，他是谁（选填）</span>
                        <input
                          aria-label={`${p.name}的分支角色`}
                          maxLength={160}
                          placeholder="比如，让现实中的老板成为我的下属"
                          value={
                            selection.personRoles?.find((r) => r.personId === p.id)?.role ?? ''
                          }
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
                          留空则由故事安排虚构角色，不会改变现实人物资料。描述最多带入前600字，共同经历最多前3段、每段前300字；不会带入聊天原话。
                        </small>
                      </label>
                    )}
                  </div>
                );
              })}
              {!profile.people.length && <p className={s.hint}>还没有记录人物。</p>}
            </details>
            <details>
              <summary>其他照片 · 已选 {optionalPhotoCount}</summary>
              {!photosReady ? <p role="status">正在核对照片用途…</p> : null}
              {roleError ? <p role="alert">{roleError}</p> : null}
              <Button type="button" variant="ghost" onClick={() => setRoleRead((n) => n + 1)}>
                重新核对照片用途
              </Button>
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
                          setSelection((old) => {
                            const assetIds = toggle(old.assetIds, id);
                            return synchronizeDraftPhotos(
                              {
                                ...old,
                                assetIds,
                                portraitAssetId:
                                  roles?.portraitAssetId && assetIds.includes(roles.portraitAssetId)
                                    ? roles.portraitAssetId
                                    : null,
                              },
                              roles!,
                            );
                          });
                        }}
                      />
                      {id === roles?.portraitAssetId
                        ? '用作本人形象（勾选确认）'
                        : '带入这张参考图'}
                    </span>
                  </label>
                ))}
              </div>
              {!pictures.length && (
                <p className={s.hint}>还没有其他可选照片。朋友照片随选中的朋友一起带入。</p>
              )}
            </details>
          </fieldset>
        )}
        {confirmed && (
          <div className={s.hint}>
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
            <Button
              variant="secondary"
              disabled={busy || !photosReady || !dirty}
              onClick={() => void act(false)}
            >
              保存草案
            </Button>
          )}
          <Button
            disabled={
              busy || (!confirmed && (!photosReady || Object.values(story).some((v) => !v.trim())))
            }
            onClick={() => void act(true)}
          >
            {busy ? '正在保存…' : confirmed ? '继续准备手机' : '确认并准备手机'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
