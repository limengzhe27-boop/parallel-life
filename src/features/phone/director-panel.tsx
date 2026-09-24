'use client';
import { useCallback, useEffect, useState } from 'react';
import type { LifeClient } from '../api/client.ts';
import type { WorldClock } from '../../contracts/world-clock.ts';

/**
 * The director panel: the user's own controls for one life.
 *
 * Everything here is honest by construction — it shows the real story time, the real
 * cost of an advance (beats played vs beats folded into a summary), refuses to rewrite
 * the past, and never claims a change happened before the server confirmed it.
 */
export function DirectorPanel({ client, worldId }: { client: LifeClient; worldId: string }) {
  const [clock, setClock] = useState<WorldClock | null>(null);
  const [actors, setActors] = useState<{ id: string; name: string }[]>([]);
  const [guidance, setGuidance] = useState('');
  const [themes, setThemes] = useState('');
  const [pacing, setPacing] = useState<'slow' | 'normal' | 'fast'>('normal');
  const [focus, setFocus] = useState<string[]>([]);
  const [impact, setImpact] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [current, world, direction] = await Promise.all([
        client.readWorldClock(worldId),
        client.world(worldId),
        client.readWorldDirection(worldId),
      ]);
      setClock(current);
      setActors(
        (world.actors ?? []).map((actor: { id: string; name: string }) => ({
          id: actor.id,
          name: actor.name,
        })),
      );
      setGuidance(direction.guidance);
      setThemes(direction.themes.join('、'));
      setPacing(direction.pacing);
      setFocus(direction.focusActorIds);
    } catch {
      setError('暂时读不到时间与导演设置，稍后再试。');
    }
  }, [client, worldId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNote('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : '这次没有完成，可以再试一次。');
    } finally {
      setBusy(false);
    }
  }

  const directionInput = () => ({
    guidance,
    themes: themes
      .split(/[、,，\s]+/)
      .map((theme) => theme.trim())
      .filter(Boolean)
      .slice(0, 5),
    pacing,
    focusActorIds: focus,
  });
  const storyTime = clock
    ? new Date(clock.storyNow).toLocaleString('zh-CN', { hour12: false })
    : '—';

  return (
    <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <section style={card}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#2563eb' }}>时间</div>
        <div style={{ fontSize: 20, fontWeight: 600 }}>{storyTime}</div>
        <div style={{ fontSize: 12, color: '#64748b' }}>
          {clock
            ? clock.paused
              ? '已暂停：世界不动，也不花费'
              : `${clock.speed}× 流逝中`
            : '读取中…'}
          {clock && clock.missedBeats > 0 ? ` · 上次有 ${clock.missedBeats} 拍已合成摘要` : ''}
        </div>
        {clock?.summary ? (
          <div style={{ fontSize: 12, color: '#475569' }}>{clock.summary}</div>
        ) : null}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <button
            style={button}
            disabled={busy || !clock}
            onClick={() =>
              run(async () => {
                const next = await client.setWorldClock(worldId, { paused: !clock!.paused });
                setClock(next);
                setNote(next.paused ? '已暂停' : '已继续');
              })
            }
          >
            {clock?.paused ? '继续' : '暂停'}
          </button>
          {[1, 2].map((speed) => (
            <button
              key={speed}
              style={speed === clock?.speed ? buttonActive : button}
              disabled={busy || !clock}
              onClick={() =>
                run(async () => {
                  setClock(await client.setWorldClock(worldId, { speed }));
                  setNote(`速度已设为 ${speed}×`);
                })
              }
            >
              {speed}×
            </button>
          ))}
          <button
            style={button}
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await client.advanceWorld(worldId);
                const [next] = await Promise.all([client.readWorldClock(worldId)]);
                setClock(next);
                setNote(
                  result.played === 0
                    ? '这段时间没有该发生的事。'
                    : `世界走了 ${result.played} 件事${result.folded ? `，另有 ${result.folded} 拍合成了摘要` : ''}。`,
                );
              })
            }
          >
            让世界走一会儿
          </button>
        </div>
      </section>

      <section style={card}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#2563eb' }}>导演要求</div>
        <textarea
          style={{ ...input, minHeight: 56 }}
          placeholder="想怎么走？例如：把节奏放慢，多写日常"
          value={guidance}
          maxLength={500}
          onChange={(event) => setGuidance(event.target.value)}
        />
        <input
          style={input}
          placeholder="主题，用、分隔，最多 5 个"
          value={themes}
          onChange={(event) => setThemes(event.target.value)}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          {(['slow', 'normal', 'fast'] as const).map((value) => (
            <button
              key={value}
              style={value === pacing ? buttonActive : button}
              onClick={() => setPacing(value)}
              disabled={busy}
            >
              {value === 'slow' ? '慢' : value === 'normal' ? '正常' : '快'}
            </button>
          ))}
        </div>
        {actors.length ? (
          <div style={{ fontSize: 12, color: '#475569' }}>
            希望谁多出场：
            {actors.map((actor) => (
              <label key={actor.id} style={{ marginRight: 10 }}>
                <input
                  type="checkbox"
                  checked={focus.includes(actor.id)}
                  disabled={busy}
                  onChange={(event) =>
                    setFocus((current) =>
                      event.target.checked
                        ? [...current, actor.id].slice(0, 3)
                        : current.filter((id) => id !== actor.id),
                    )
                  }
                />
                {actor.name}
              </label>
            ))}
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            style={button}
            disabled={busy}
            onClick={() =>
              run(async () => {
                const receipt = await client.setWorldDirection(worldId, {
                  ...directionInput(),
                  preview: true,
                });
                setImpact(
                  `接下来一次最多 ${receipt.impact.beatsPerAdvance} 件事` +
                    (receipt.impact.speaksFirst ? `，先出场：${receipt.impact.speaksFirst}` : '') +
                    (receipt.impact.themes.length
                      ? `，主题：${receipt.impact.themes.join('、')}`
                      : ''),
                );
              })
            }
          >
            先看影响
          </button>
          <button
            style={buttonActive}
            disabled={busy}
            onClick={() =>
              run(async () => {
                await client.setWorldDirection(worldId, directionInput());
                setImpact('已生效，会影响接下来发生的事。');
              })
            }
          >
            应用
          </button>
        </div>
        {impact ? <div style={{ fontSize: 12, color: '#475569' }}>{impact}</div> : null}
        <div style={{ fontSize: 12, color: '#94a3b8' }}>
          已经发生的事不会被改写；想换一种走法，请建立一个分支，原本的人生会保留。
        </div>
      </section>

      {note ? <div style={{ fontSize: 13, color: '#0f766e' }}>{note}</div> : null}
      {error ? (
        <div role="alert" style={{ fontSize: 13, color: '#b91c1c' }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

const card: React.CSSProperties = {
  background: '#f8fafc',
  borderRadius: 16,
  padding: 14,
  border: '1px solid #e2e8f0',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};
const input: React.CSSProperties = {
  borderRadius: 10,
  border: '1px solid #cbd5e1',
  padding: '8px 10px',
  fontSize: 14,
};
const button: React.CSSProperties = {
  borderRadius: 999,
  border: '1px solid #cbd5e1',
  background: '#fff',
  padding: '6px 14px',
  fontSize: 13,
};
const buttonActive: React.CSSProperties = {
  ...button,
  background: '#2563eb',
  color: '#fff',
  borderColor: '#2563eb',
};
