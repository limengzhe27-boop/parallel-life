'use client';
import { useRef, useState } from 'react';
import { LifeDate, type Profile, type ProfileEdit } from '../../contracts/api.ts';
import { Button, Notice } from '../../components/ui.tsx';
const fields = [
  ['姓名', 'text', '希望我怎么称呼你'],
  ['生日', 'date', ''],
  ['出生时间', 'time', ''],
  ['所在城市', 'text', '现在生活的城市'],
  ['职业', 'text', '目前在做什么'],
  ['家乡', 'text', '从哪里长大'],
] as const;
export function BasicInfo({
  profile,
  onSave,
  compact = false,
}: {
  profile: Profile;
  onSave: (operation: ProfileEdit['operation']) => Promise<void>;
  compact?: boolean;
}) {
  const existing = profile.facts.find(
    (f) => f.category === 'identity' && f.status !== 'rejected' && f.value.startsWith('个人资料\n'),
  );
  const initial = Object.fromEntries(
    fields.map(([label]) => [
      label,
      existing?.value
        .split('\n')
        .find((line) => line.startsWith(label + '：'))
        ?.slice(label.length + 1) ?? '',
    ]),
  );
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const id = useRef(existing?.id ?? null);
  async function save() {
    if (busy) return;
    const today = new Date().toLocaleDateString('en-CA');
    if (values['生日'] && (!LifeDate.safeParse(values['生日']).success || values['生日'] > today)) {
      setError('请检查生日，不能晚于今天。');
      return;
    }
    if (!Object.values(values).some((value) => value.trim())) {
      setError('可以先填一项，也可以直接聊天。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      id.current ??= crypto.randomUUID();
      await onSave({
        kind: 'set-fact',
        id: id.current,
        category: 'identity',
        value:
          '个人资料\n' +
          fields
            .filter(([label]) => (values[label] ?? '').trim())
            .map(([label]) => `${label}：${(values[label] ?? '').trim()}`)
            .join('\n'),
      });
      setSaved(true);
    } catch {
      setError('没有保存成功，填写的内容还在，请重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="basic-info"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div>
        <h3>{compact ? '先认识一下你' : '基本资料'}</h3>
        <p>
          {compact ? '告诉我怎么称呼你，或者直接聊聊最近的事。' : '都可以选填，也可以随时修改。'}
        </p>
      </div>
      <div className="basic-info-fields">
        {fields.slice(0, compact ? 2 : fields.length).map(([label, type, placeholder]) => (
          <label key={label}>
            <span>
              {label}
              {label === '姓名' && ' / 昵称'}
            </span>
            <input
              className="field"
              type={type}
              aria-label={label}
              max={type === 'date' ? new Date().toLocaleDateString('en-CA') : undefined}
              maxLength={100}
              value={values[label]}
              placeholder={placeholder}
              disabled={busy}
              onChange={(e) => {
                setValues({ ...values, [label]: e.target.value });
                setSaved(false);
              }}
            />
          </label>
        ))}
      </div>
      {error && <Notice>{error}</Notice>}
      <div className="basic-info-actions">
        <span role="status">
          {saved
            ? '已保存到「我的」'
            : compact
              ? '选填 · 不影响开始聊天'
              : '仅记录你主动提供的信息'}
        </span>
        <Button type="submit" variant="secondary" disabled={busy}>
          {busy ? '正在保存…' : '保存资料'}
        </Button>
      </div>
    </form>
  );
}
