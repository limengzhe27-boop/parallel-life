'use client';
import { useRef, useState } from 'react';
import { LifeDate, type Profile, type ProfileEdit } from '../../contracts/api.ts';
import { Button, Notice } from '../../components/ui.tsx';
import { readBasicInfo, writeBasicInfo } from '../../modules/profile/domain/profile-view.ts';
const fields = [
  ['姓名', 'text', '希望我怎么称呼你'],
  ['生日', 'text', '年份、年月或完整日期，如 1998 / 1998-05 / 1998-05-12'],
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
  const parsed = readBasicInfo(existing?.value ?? '个人资料\n');
  const initial = Object.fromEntries(fields.map(([label]) => [label, parsed.values[label] ?? '']));
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const id = useRef(existing?.id ?? null);
  const mergedValue = writeBasicInfo(existing?.value, values);
  const mergedLength = mergedValue.length;
  const isOverLength = mergedLength > 500;

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
    if (isOverLength) {
      setError(`基本资料合并后共 ${mergedLength} 字，超过了 500 字上限，请精简内容后再保存。`);
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
        value: mergedValue,
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
              maxLength={100}
              value={values[label]}
              placeholder={placeholder}
              disabled={busy}
              onChange={(e) => {
                setValues({ ...values, [label]: e.target.value });
                setSaved(false);
                setError('');
              }}
            />
          </label>
        ))}
      </div>
      {parsed.remaining.some((line) => line.trim()) && (
        <p>此记录还有未归类或重复的原始字段，保存时会保留；可在“待整理资料”中编辑原记录。</p>
      )}
      <div className={`basic-info-counter ${isOverLength ? 'over-limit' : ''}`}>
        已填资料合并计：{mergedLength} / 500 字 {isOverLength ? '（已超出上限，请精简）' : ''}
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
        <Button type="submit" variant="secondary" disabled={busy || isOverLength}>
          {busy ? '正在保存…' : '保存资料'}
        </Button>
      </div>
    </form>
  );
}
