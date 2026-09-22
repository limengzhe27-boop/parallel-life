'use client';
import { useState } from 'react';
import { LifeDate, type LifeEvent, type ProfileEdit, type Person } from '../../contracts/api.ts';
import { Button, Icon, Modal, Notice } from '../../components/ui.tsx';
import { curvePoints } from './life-curve.ts';
import { ApiFailure, LifeClient } from '../api/client.ts';
const failure = (e: unknown) =>
  e instanceof ApiFailure ? e.message : '暂时没有保存，输入已保留，请重试。';
export function LifeEvents({
  events,
  onSave,
}: {
  events: LifeEvent[];
  onSave: (op: ProfileEdit['operation']) => Promise<void>;
}) {
  const [editing, setEditing] = useState<LifeEvent | null>(null),
    [open, setOpen] = useState(false);
  const points = curvePoints(events),
    rated = points.filter((p) => p.y !== null);
  let path = '';
  points.forEach((p, i) => {
    if (p.y === null) return;
    path += `${i > 0 && points[i - 1]?.y !== null ? 'L' : 'M'}${p.x},${p.y} `;
  });
  const sorted = [...events].sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
  return (
    <>
      <div className="profile-section life-section">
        <div className="section-heading">
          <h3>
            <Icon name="book" size={17} />
            我的人生 K 线
          </h3>
          <Button
            variant="ghost"
            className="icon-button"
            aria-label="补充一件往事"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Icon name="plus" size={18} />
          </Button>
        </div>
        <p className="curve-caption">那些起伏，只有你能定义。</p>
        {rated.length ? (
          <svg
            className="life-curve"
            viewBox="0 0 320 150"
            role="img"
            aria-label="根据你记录的日期和感受绘制的人生曲线，空白表示尚未填写"
          >
            <path d="M20 20V123H300" className="curve-axis" />
            <path d="M20 70H300" className="curve-baseline" />
            <text x="24" y="14">
              更明亮
            </text>
            <text x="24" y="140">
              更低落
            </text>
            <path d={path} className="curve-line" />
            {rated.map((p) => (
              <g key={p.event.id}>
                <circle cx={p.x} cy={p.y!} r="4" className="curve-dot" />
                <title>
                  {p.event.title} · {p.event.date} · {p.event.feeling}
                </title>
              </g>
            ))}
          </svg>
        ) : (
          <div className="curve-empty">
            <div className="empty-timeline" aria-hidden="true">
              <i />
              <span />
              <i />
              <span />
              <i />
            </div>
            <p>
              给往事标记当时的感受，
              <br />
              你的轨迹就会慢慢连起来。
            </p>
          </div>
        )}
        {sorted.length > 0 && (
          <div className="event-list">
            {sorted.map((event) => (
              <button
                key={event.id}
                className="event-row"
                onClick={() => {
                  setEditing(event);
                  setOpen(true);
                }}
              >
                <span className="event-date">{event.date ?? '时间未填写'}</span>
                <span className="event-description">
                  <strong>{event.title}</strong>
                  <small>
                    {event.feeling === null
                      ? '还没有记录当时的感受'
                      : `当时的感受 · ${event.feeling > 0 ? '+' : ''}${event.feeling}`}
                  </small>
                </span>
                <Icon name="edit" size={13} />
              </button>
            ))}
          </div>
        )}
        <Button
          variant="ghost"
          className="add-event"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Icon name="plus" size={15} />
          补充一件往事
        </Button>
      </div>
      {open && (
        <EventEditor
          key={editing?.id ?? 'new'}
          event={editing}
          onClose={() => setOpen(false)}
          onSave={onSave}
        />
      )}
    </>
  );
}
function EventEditor({
  event,
  onClose,
  onSave,
}: {
  event: LifeEvent | null;
  onClose: () => void;
  onSave: (op: ProfileEdit['operation']) => Promise<void>;
}) {
  const [title, setTitle] = useState(event?.title ?? ''),
    [date, setDate] = useState(event?.date ?? ''),
    [rated, setRated] = useState(event?.feeling !== null && event?.feeling !== undefined),
    [feeling, setFeeling] = useState(event?.feeling ?? 0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function save(remove = false) {
    setError('');
    if (!remove && (!title.trim() || (date.trim() && !LifeDate.safeParse(date.trim()).success))) {
      setError('请填写事件，并检查日期。可以只写年份，也可以留空。');
      return;
    }
    setBusy(true);
    try {
      await onSave(
        remove
          ? { kind: 'delete-event', id: event!.id }
          : {
              kind: 'set-event',
              event: {
                id: event?.id ?? crypto.randomUUID(),
                title,
                date: date.trim() || null,
                feeling: rated ? feeling : null,
              },
            },
      );
      onClose();
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={event ? '回到那个时刻' : '记下一件往事'}
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
        <label className="form-label">
          发生了什么
          <input
            autoFocus
            className="field"
            placeholder="例如，第一次离开家乡"
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="form-label">
          发生时间 · 可以留空
          <input
            className="field"
            placeholder="例如 2022 或 2022-06-18"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="rating-toggle">
          <input type="checkbox" checked={rated} onChange={(e) => setRated(e.target.checked)} />
          记录当时的感受
        </label>
        {rated ? (
          <div className="rating-area">
            <label htmlFor="feeling-range">
              那时的你，感受如何？
              <strong>
                {feeling > 0 ? '+' : ''}
                {feeling}
              </strong>
            </label>
            <input
              id="feeling-range"
              aria-label="当时的感受"
              type="range"
              min={-5}
              max={5}
              step={1}
              value={feeling}
              onChange={(e) => setFeeling(Number(e.target.value))}
            />
            <div>
              <span>很低落 −5</span>
              <span>平静 0</span>
              <span>很明亮 +5</span>
            </div>
          </div>
        ) : (
          <p className="form-hint">暂时不确定也没关系，曲线会为这里留白。</p>
        )}
        {error && <Notice>{error}</Notice>}
        <div className="form-actions">
          {event && (
            <Button type="button" variant="danger" disabled={busy} onClick={() => void save(true)}>
              移除节点
            </Button>
          )}
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={busy || !title.trim()}>
            {busy ? '保存中…' : '保存这段经历'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function ImportantPeople({
  people,
  client,
  onSave,
}: {
  people: Person[];
  client: LifeClient;
  onSave: (op: ProfileEdit['operation']) => Promise<void>;
}) {
  const [editing, setEditing] = useState<Person | null>(null),
    [open, setOpen] = useState(false);
  return (
    <>
      <div className="profile-section">
        <div className="section-heading">
          <h3>
            <Icon name="user" size={17} />
            生命里重要的人
          </h3>
          <Button
            variant="ghost"
            className="icon-button"
            aria-label="添加重要的人"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Icon name="plus" size={18} />
          </Button>
        </div>
        {people.length === 0 ? (
          <p className="section-copy">
            那个陪你走过一段路的人，
            <br />
            也可以出现在你的故事里。
          </p>
        ) : (
          people.map((person) => (
            <button
              className="person-row"
              key={person.id}
              onClick={() => {
                setEditing(person);
                setOpen(true);
              }}
            >
              <span className="person-photo">
                {person.assetId ? (
                  <img src={`/api/v1/assets/${person.assetId}`} alt={`${person.name}的照片`} />
                ) : (
                  <Icon name="user" />
                )}
              </span>
              <span>
                <strong>{person.name}</strong>
                <small>{person.relationship}</small>
              </span>
              <Icon name="edit" size={14} />
            </button>
          ))
        )}
      </div>
      {open && (
        <PersonEditor
          key={editing?.id ?? 'new-person'}
          person={editing}
          client={client}
          onSave={onSave}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
function PersonEditor({
  person,
  client,
  onClose,
  onSave,
}: {
  person: Person | null;
  client: LifeClient;
  onClose: () => void;
  onSave: (op: ProfileEdit['operation']) => Promise<void>;
}) {
  const [name, setName] = useState(person?.name ?? ''),
    [relationship, setRelationship] = useState(person?.relationship ?? ''),
    [assetId, setAssetId] = useState(person?.assetId ?? null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function photo(file: File) {
    setBusy(true);
    setError('');
    try {
      const asset = await client.upload(file);
      setAssetId(asset.id);
    } catch (e) {
      setError(failure(e));
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
          ? { kind: 'delete-person', id: person!.id }
          : {
              kind: 'set-person',
              person: { id: person?.id ?? crypto.randomUUID(), name, relationship, assetId },
            },
      );
      onClose();
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={person ? '这个人，在你的人生里' : '记下一个重要的人'}
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
        <label className="form-label">
          你怎么称呼 TA
          <input
            autoFocus
            className="field"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            placeholder="可以是真名，也可以是昵称"
          />
        </label>
        <label className="form-label">
          你们的关系
          <input
            className="field"
            value={relationship}
            maxLength={80}
            onChange={(e) => setRelationship(e.target.value)}
            placeholder="例如，大学时最好的朋友"
          />
        </label>
        <label className="person-upload">
          {assetId ? (
            <img src={`/api/v1/assets/${assetId}`} alt="选择的人物照片" />
          ) : (
            <Icon name="photo" size={26} />
          )}
          <span>{busy ? '正在保存…' : assetId ? '更换照片' : '选一张 TA 的照片（可选）'}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label="重要人物的照片"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void photo(file);
            }}
          />
        </label>
        {assetId && (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setAssetId(null)}>
            暂时不用这张照片
          </Button>
        )}
        {error && <Notice>{error}</Notice>}
        <p className="form-hint">这份人物记录只保存在你的私人档案里。</p>
        <div className="form-actions">
          {person && (
            <Button type="button" variant="danger" disabled={busy} onClick={() => void save(true)}>
              移除记录
            </Button>
          )}
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={busy || !name.trim() || !relationship.trim()}>
            {busy ? '保存中…' : '保存人物'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
