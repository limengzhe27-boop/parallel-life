'use client';
import { useRef, useState } from 'react';
import type { Person, ProfileEdit } from '../../contracts/api.ts';
import { Button, Icon, Modal, Notice } from '../../components/ui.tsx';
import { personDisplayName, personKnownName } from '../../modules/profile/domain/person-record.ts';
import { ApiFailure, type LifeClient } from '../api/client.ts';
import s from './person-editor.module.css';
import { PhotoDraft } from './photo-draft.ts';
export function PersonEditor({
  person,
  client,
  onClose,
  onSave,
}: {
  person: Person | null;
  client: LifeClient;
  onClose: () => void;
  onSave: (operation: ProfileEdit['operation']) => Promise<void>;
}) {
  const id = useRef(person?.id ?? crypto.randomUUID());
  const [photos] = useState(() => new PhotoDraft());
  const [editing, setEditing] = useState(!person),
    [knownName, setKnownName] = useState(person ? personKnownName(person) : ''),
    [temporaryLabel, setTemporaryLabel] = useState(
      person?.temporaryLabel ?? (person && !('knownName' in person) ? person.name : ''),
    ),
    [relationship, setRelationship] = useState(
      person?.relationship === '尚未说明' ? '' : (person?.relationship ?? ''),
    ),
    [interaction, setInteraction] = useState(person?.interaction ?? ''),
    [experiences, setExperiences] = useState(person?.experiences ?? []),
    [assetId, setAssetId] = useState(person?.assetId ?? null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const fail = (e: unknown) =>
    e instanceof ApiFailure ? e.message : '暂时没有保存，输入还在，请重试。';
  async function photo(file: File) {
    if (!file.size || file.size > 4 * 1024 * 1024) {
      setError('请选择 4MB 以内的图片。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const uploaded = await client.upload(file);
      photos.add(uploaded.id);
      setAssetId(uploaded.id);
      await photos.discard(client, uploaded.id);
    } catch (e) {
      setError(fail(e));
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await photos.discard(client);
      onClose();
    } catch {
      setError('未保存的照片暂时没有清理完成，请再点一次取消。');
    } finally {
      setBusy(false);
    }
  }
  async function removePhoto() {
    setBusy(true);
    setError('');
    try {
      await photos.discard(client);
      setAssetId(null);
    } catch {
      setError('这张未保存的照片暂时没有清理完成，请重试。');
    } finally {
      setBusy(false);
    }
  }
  async function save(remove = false) {
    setBusy(true);
    setError('');
    try {
      await onSave(
        remove
          ? { kind: 'delete-person', id: id.current }
          : {
              kind: 'set-person',
              person: {
                id: id.current,
                name: personDisplayName(knownName, temporaryLabel),
                knownName: knownName.trim() || null,
                temporaryLabel: temporaryLabel.trim() || null,
                relationship: relationship.trim() || '尚未说明',
                interaction,
                experiences,
                assetId,
              },
            },
      );
      photos.saved(remove ? null : assetId);
      await photos.discard(client);
      onClose();
    } catch (e) {
      setError(fail(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={person?.name ?? '记下身边的一个人'}
      onClose={() => {
        if (!busy) void close();
      }}
    >
      {!editing && person ? (
        <div className={s.details}>
          {person.assetId && (
            <img
              className={s.photo}
              src={`/api/v1/assets/${person.assetId}`}
              alt={`${person.name}的原图`}
            />
          )}
          <p>现实关系：{person.relationship}</p>
          {person.temporaryLabel && <p>临时称呼：{person.temporaryLabel}</p>}
          <section>
            <h3>我的描述</h3>
            <p>{person.interaction || '还没有记录。'}</p>
            <small>这是你的描述，不是客观诊断或模型推断。</small>
          </section>
          <section>
            <h3>共同经历</h3>
            {person.experiences?.length ? (
              person.experiences.map((e) => (
                <p key={e.id}>
                  {e.date && <small>{e.date} · </small>}
                  {e.text}
                </p>
              ))
            ) : (
              <p>还没有记录。</p>
            )}
          </section>
          <section>
            <h3>资料来源</h3>
            <p>
              {person.origin === 'manual'
                ? person.sourceQuotes?.length
                  ? '你手工填写的资料与聊天原话'
                  : '你手工填写或修改'
                : person.origin === 'interview'
                  ? '从你的聊天原话整理'
                  : '此前保存的记录，来源未标注'}
            </p>
            {person.updatedAt && <time>{new Date(person.updatedAt).toLocaleString('zh-CN')}</time>}
            {person.sourceQuotes?.map((q, i) => (
              <blockquote key={q.messageId + ':' + i}>
                {q.quote}
                <small>
                  {person.origin === 'manual'
                    ? '此前聊天原话，不代表本次手工修改的证据'
                    : '你的聊天原话'}
                </small>
              </blockquote>
            ))}
          </section>
          <Button onClick={() => setEditing(true)}>补充或纠正资料</Button>
        </div>
      ) : (
        <form
          className={s.form}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p className="form-hint">先记下你想说的部分。只有临时称呼、没有照片也可以继续。</p>
          <fieldset disabled={busy} className={s.fields}>
            <label>
              姓名或昵称（选填）
              <input
                autoFocus
                className="field"
                maxLength={80}
                value={knownName}
                onChange={(e) => setKnownName(e.target.value)}
                placeholder="知道时再填"
              />
            </label>
            <label>
              临时称呼（选填）
              <input
                className="field"
                maxLength={80}
                value={temporaryLabel}
                onChange={(e) => setTemporaryLabel(e.target.value)}
                placeholder="比如，表姐、隔壁同事"
              />
            </label>
            <label>
              现实关系（选填）
              <input
                className="field"
                maxLength={80}
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                placeholder="比如，表姐、同事"
              />
            </label>
            <label>
              我的描述（选填）
              <textarea
                className="field"
                rows={3}
                maxLength={1200}
                value={interaction}
                onChange={(e) => setInteraction(e.target.value)}
                placeholder="可以写性格、习惯、能力、经历、看法或互动"
              />
            </label>
            <section>
              <h3>具体共同经历（选填）</h3>
              {experiences.map((experience, i) => (
                <div className={s.experience} key={experience.id}>
                  <label>
                    经历 {i + 1}
                    <textarea
                      className="field"
                      rows={2}
                      maxLength={500}
                      value={experience.text}
                      onChange={(e) =>
                        setExperiences(
                          experiences.map((x) =>
                            x.id === experience.id ? { ...x, text: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setExperiences(experiences.filter((x) => x.id !== experience.id))
                    }
                  >
                    移除这条经历
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                disabled={experiences.length >= 10}
                onClick={() =>
                  setExperiences([
                    ...experiences,
                    { id: crypto.randomUUID(), text: '', date: null },
                  ])
                }
              >
                添加一段经历
              </Button>
            </section>
            <label className="person-upload">
              {assetId ? (
                <img src={`/api/v1/assets/${assetId}`} alt="已选择的原图" />
              ) : (
                <Icon name="photo" size={26} />
              )}
              <span>{busy ? '正在保存…' : assetId ? '更换照片或头像' : '照片或头像（选填）'}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="身边人的照片或头像"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void photo(file);
                }}
              />
            </label>
            <p className="form-hint">
              每人 1 张，最大 4MB。普通头像仅作展示，不会据此推断长相或身份。
            </p>
            {assetId && (
              <Button type="button" variant="ghost" onClick={() => void removePhoto()}>
                暂时不用这张图片
              </Button>
            )}
          </fieldset>
          {error && <Notice>{error}</Notice>}
          <p className="form-hint">这里保存现实资料。每段平行人生的角色身份分别记录。</p>
          <div className="form-actions">
            {person && (
              <Button
                type="button"
                variant="danger"
                disabled={busy}
                onClick={() => void save(true)}
              >
                移除记录
              </Button>
            )}
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void close()}>
              取消
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                !personDisplayName(knownName, temporaryLabel) ||
                experiences.some((e) => !e.text.trim())
              }
            >
              {busy ? '保存中…' : '保存人物'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
