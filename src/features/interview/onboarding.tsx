'use client';
import { useRef, useState } from 'react';
import { Button, Icon, Notice } from '../../components/ui.tsx';
import { AppViewport } from '../../components/app-viewport.tsx';
import { LifeDate, type Profile, type ProfileEdit } from '../../contracts/api.ts';
export function Onboarding({
  profile,
  onStart,
  onSave,
}: {
  profile: Profile;
  onStart: () => void;
  onSave: (operation: ProfileEdit['operation']) => Promise<void>;
}) {
  const [date, setDate] = useState(''),
    [time, setTime] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const factId = useRef<string | null>(null);
  const today = new Date().toLocaleDateString('en-CA');
  async function start() {
    if (busy) return;
    if (!date || !LifeDate.safeParse(date).success || date > today) {
      setError('请选一个有效的出生日期，或直接开始聊天。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      factId.current ??=
        profile.facts.find((f) => f.category === 'identity' && f.value.startsWith('出生日期：'))
          ?.id ?? crypto.randomUUID();
      await onSave({
        kind: 'set-fact',
        id: factId.current,
        category: 'identity',
        value: `出生日期：${date}；出生时间：${time || '暂不清楚'}`,
      });
      onStart();
    } catch {
      setError('暂时没有保存成功，填写的内容还在。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="onboarding app-workspace">
      <AppViewport />
      <header className="onboarding-header">
        <span className="onboarding-brand">如果</span>
        <Button variant="ghost" disabled={busy} onClick={onStart}>
          直接聊聊 <Icon name="chevron" size={14} />
        </Button>
      </header>
      <main className="onboarding-content">
        <div className="onboarding-title">
          <p>另一种生活，从真实的你开始</p>
          <h1>
            人生，
            <br />
            还有另一种可能。
          </h1>
        </div>
        <form
          className="onboarding-form"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <p>先留一个关于你的小线索。</p>
          <label>
            <span>出生日期</span>
            <input
              type="date"
              aria-label="出生日期"
              value={date}
              max={today}
              disabled={busy}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            <span>
              出生时间 <small>可不填</small>
            </span>
            <input
              type="time"
              aria-label="出生时间（可不填）"
              value={time}
              disabled={busy}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
          <p className="onboarding-context">
            只记录你提供的信息，不凭生日判断性格或预测命运。之后都可以修改。
          </p>
          {error && <Notice>{error}</Notice>}
          <Button type="submit" disabled={busy}>
            {busy ? '正在记下…' : '从我开始'}
            <Icon name="arrow" size={17} />
          </Button>
        </form>
      </main>
    </div>
  );
}
