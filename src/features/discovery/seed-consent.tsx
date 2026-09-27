'use client';
import { useRef, useState } from 'react';
import { Button, Icon, Modal, Notice } from '../../components/ui.tsx';
import { LifeClient, ApiFailure } from '../api/client.ts';
import type { Profile } from '../../contracts/api.ts';
import type { Discovery, LifeDirection } from '../../contracts/discovery.ts';
import type { ApprovedSeed, SeedRequest } from '../../contracts/seeds.ts';
export function SeedConsent({
  direction,
  profile,
  discovery,
  client,
  onClose,
  onSaved,
}: {
  direction: LifeDirection;
  profile: Profile;
  discovery: Discovery;
  client: LifeClient;
  onClose: () => void;
  onSaved: (seed: ApprovedSeed) => void;
}) {
  const confirmedFacts = profile.facts.filter((f) => f.status === 'confirmed');
  const visibleFactIds = new Set(confirmedFacts.map((f) => f.id));
  const [facts, setFacts] = useState(
    direction.sources.map((s) => s.factId).filter((id) => visibleFactIds.has(id)),
  );
  const [people, setPeople] = useState<string[]>([]),
    [portrait, setPortrait] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = useRef<SeedRequest | null>(null);
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  async function save() {
    setBusy(true);
    setError('');
    const fields = {
      discoveryVersion: discovery.version,
      profileVersion: profile.version,
      directionId: direction.id,
      factIds: facts.filter((id) => visibleFactIds.has(id)),
      personIds: people,
      includePortrait: portrait,
    };
    const prior = pending.current;
    const request =
      prior && JSON.stringify({ ...prior, commandId: undefined }) === JSON.stringify(fields)
        ? prior
        : { ...fields, commandId: crypto.randomUUID() };
    pending.current = request;
    try {
      const seed = await client.approveSeed(request);
      onSaved(seed);
      onClose();
    } catch (e) {
      setError(
        e instanceof ApiFailure
          ? e.code === 'VERSION_CONFLICT'
            ? '资料已经更新，请返回并用最新资料重新构想后再选择。'
            : e.message
          : '这次没有保存成功，选择仍然保留，请重试。',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="带上哪些人和事？"
      className="seed-modal"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="seed-introduction">选择要带进这段人生的资料。</p>
        <details className="seed-story">
          <summary>{direction.title}</summary>
          <p>{direction.premise}</p>
          <p>{direction.opening}</p>
          <small>{direction.tradeoff}</small>
        </details>
        <fieldset className="seed-fieldset">
          <legend>带上哪些资料</legend>
          <p>
            只带入你勾选的内容（已选择 {facts.filter((id) => visibleFactIds.has(id)).length} /{' '}
            {confirmedFacts.length} 项）。
          </p>
          {confirmedFacts.length > 0 ? (
            <div className="seed-facts-scroll">
              {confirmedFacts.map((f) => {
                const isBasicInfo = f.value.startsWith('个人资料\n');
                const subFields = isBasicInfo ? f.value.split('\n').slice(1).filter(Boolean) : [];
                return (
                  <label
                    key={f.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      padding: '4px 0',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="checkbox"
                        checked={facts.includes(f.id)}
                        onChange={() => setFacts(toggle(facts, f.id))}
                        disabled={busy}
                      />
                      <span>{isBasicInfo ? '基础资料（身份与居住背景）' : f.value}</span>
                    </div>
                    {isBasicInfo && subFields.length > 0 && (
                      <div
                        style={{
                          paddingLeft: '24px',
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '6px',
                        }}
                      >
                        {subFields.map((fieldStr, idx) => (
                          <span
                            key={idx}
                            style={{
                              fontSize: '11px',
                              background: 'rgba(255, 255, 255, 0.06)',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {fieldStr}
                          </span>
                        ))}
                      </div>
                    )}
                  </label>
                );
              })}
            </div>
          ) : (
            <p>没有额外选择的现实资料。</p>
          )}
        </fieldset>
        <fieldset className="seed-fieldset">
          <legend>照片与人物</legend>
          {profile.portraitAssetId && (
            <label>
              <input
                type="checkbox"
                checked={portrait}
                onChange={(e) => setPortrait(e.target.checked)}
                disabled={busy}
                aria-label="带入本人及参考照片"
              />
              <span>
                带上以下照片（
                {new Set([profile.portraitAssetId, ...(profile.referenceAssetIds ?? [])]).size} 张）
              </span>
              {[...new Set([profile.portraitAssetId, ...(profile.referenceAssetIds ?? [])])].map(
                (id) => (
                  <img key={id} src={`/api/v1/assets/${id}`} alt="将带入的照片" />
                ),
              )}
            </label>
          )}
          {profile.people.map((p) => (
            <label key={p.id}>
              <input
                type="checkbox"
                checked={people.includes(p.id)}
                onChange={() => setPeople(toggle(people, p.id))}
                disabled={busy}
              />
              {p.assetId && <img src={`/api/v1/assets/${p.assetId}`} alt={`${p.name}的照片`} />}
              <span>
                {p.name}
                <small>
                  {p.relationship}
                  {p.assetId ? ' · 包含这张照片' : ''}
                </small>
              </span>
            </label>
          ))}
          {!profile.portraitAssetId && !profile.people.length && (
            <p>还没有照片或人物，可以之后回到档案补充。</p>
          )}
        </fieldset>
        <p className="seed-private">
          <Icon name="lock" size={14} />
          这份选择只用于当前分支。
        </p>
        {error && <Notice>{error}</Notice>}
        <div className="form-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            返回
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? '正在保存…' : '带入这段人生'}
            <Icon name="check" size={16} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function SeedReceipt({
  seed,
  onClose,
  children,
  ready = false,
}: {
  seed: ApprovedSeed;
  onClose: () => void;
  children?: React.ReactNode;
  ready?: boolean;
}) {
  return (
    <Modal open title="这个想法，记下了" className="seed-modal" onClose={onClose}>
      <details className="seed-story">
        <summary>{seed.story.title}</summary>
        <p>{seed.story.premise}</p>
        <p>{seed.story.opening}</p>
        <small>{seed.story.tradeoff}</small>
      </details>
      <div className="seed-receipt-details">
        <h3>带入的资料</h3>
        {seed.facts.length ? (
          <ul>
            {seed.facts.map((f) => (
              <li key={f.factId}>{f.value}</li>
            ))}
          </ul>
        ) : (
          <p>未额外带入现实资料。</p>
        )}
        <h3>照片与人物</h3>
        <p>
          {seed.portraitAssetId ? '包含本人照片' : '未带入本人照片'}；
          {seed.people.length ? seed.people.map((p) => p.name).join('、') : '未带入重要人物'}。
        </p>
        <p>{ready ? '世界已生成。' : '设定已保存。'}之后修改现实档案，不会自动改变这里。</p>
      </div>
      {children}
      <div className="form-actions">
        <Button onClick={onClose}>关闭</Button>
      </div>
    </Modal>
  );
}
