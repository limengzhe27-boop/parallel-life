'use client';
import s from './publisher-workbench.module.css';

type Row = Record<string, unknown>;
export function PublisherSpaceEditor({
  content,
  disabled,
  onChange,
}: {
  content: Record<string, unknown>;
  disabled: boolean;
  onChange: (content: Record<string, unknown>) => void;
}) {
  const places = Array.isArray(content.places) ? (content.places as Row[]) : [];
  const routes = Array.isArray(content.routes) ? (content.routes as Row[]) : [];
  if (
    (content.places !== undefined && !Array.isArray(content.places)) ||
    (content.routes !== undefined && !Array.isArray(content.routes))
  )
    return <p>原地点或路线格式需要整理，已保留原稿。</p>;
  if ([...places, ...routes].some((row) => !row || typeof row !== 'object' || Array.isArray(row)))
    return <p>原地点或路线格式需要整理，已保留原稿。</p>;
  const updatePlace = (index: number, patch: Row) => {
    if (!disabled)
      onChange({
        ...content,
        places: places.map((row, i) => (i === index ? { ...row, ...patch } : row)),
      });
  };
  const updateRoute = (index: number, patch: Row) => {
    if (!disabled)
      onChange({
        ...content,
        routes: routes.map((row, i) => (i === index ? { ...row, ...patch } : row)),
      });
  };
  return (
    <section className={s.card} aria-label="地点与路线编辑">
      <div className={s.sectionHeader}>
        <h3 className={s.sectionTitle}>地点与路线</h3>
        <p className={s.sectionHint}>
          先核对地点名称与一句说明，需要时展开修改；不用在这里重写故事背景。
        </p>
      </div>
      {places.map((place, index) => (
        <details className={s.placeDetails} key={String(place.key ?? index)} open={!place.name}>
          <summary>
            {(typeof place.name === 'string' && place.name) || `地点 ${index + 1}`}
            <span className={s.placeSummary}>
              {typeof place.description === 'string' && place.description
                ? place.description
                : '尚无地点说明，点击修改（选填）'}
            </span>
          </summary>
          <fieldset
            disabled={disabled}
            style={{
              border: '1px solid #dbe1e8',
              borderRadius: 10,
              padding: 14,
              margin: '0 0 14px',
              minWidth: 0,
            }}
          >
            <legend>{(typeof place.name === 'string' && place.name) || `地点 ${index + 1}`}</legend>
            <div className={s.formGrid}>
              <label className={s.formField}>
                地点名称
                <input
                  className={s.input}
                  value={typeof place.name === 'string' ? place.name : ''}
                  maxLength={100}
                  onChange={(event) => updatePlace(index, { name: event.target.value })}
                />
              </label>
              <label className={s.formFieldFull}>
                地图地址与场所说明（选填）
                <textarea
                  className={s.textarea}
                  value={typeof place.description === 'string' ? place.description : ''}
                  maxLength={800}
                  rows={3}
                  onChange={(event) => updatePlace(index, { description: event.target.value })}
                  placeholder="一句说明即可；原有长文可以保留，无需重写故事背景。"
                />
              </label>
            </div>
            <label>
              <input
                type="checkbox"
                checked={place.knownAtStart === true}
                onChange={(event) => updatePlace(index, { knownAtStart: event.target.checked })}
              />
              开场时玩家知道这个地点
            </label>
          </fieldset>
        </details>
      ))}
      <button
        type="button"
        className={s.btn}
        disabled={disabled || places.length >= 24}
        onClick={() => {
          if (disabled || places.length >= 24) return;
          const keys = new Set(places.map((p) => p.key));
          let index = 1;
          while (keys.has(`place_new_${index}`)) index++;
          onChange({
            ...content,
            places: [
              ...places,
              { key: `place_new_${index}`, name: '', description: '', knownAtStart: false },
            ],
          });
        }}
      >
        添加地点
      </button>
      <p className={s.sectionHint}>
        路线按方向填写；返程需要另加一条。耗时由剧本设定，不是现实地图测距。
      </p>
      {routes.map((route, index) => (
        <div className={s.formGrid} key={index}>
          <label className={s.formField}>
            出发地点
            <select
              className={s.input}
              disabled={disabled}
              value={typeof route.fromPlaceKey === 'string' ? route.fromPlaceKey : ''}
              onChange={(event) => updateRoute(index, { fromPlaceKey: event.target.value })}
            >
              <option value="">选择出发地点</option>
              {places.map((p) => (
                <option key={String(p.key)} value={String(p.key)}>
                  {String(p.name || '待命名地点')}
                </option>
              ))}
            </select>
          </label>
          <label className={s.formField}>
            到达地点
            <select
              className={s.input}
              disabled={disabled}
              value={typeof route.toPlaceKey === 'string' ? route.toPlaceKey : ''}
              onChange={(event) => updateRoute(index, { toPlaceKey: event.target.value })}
            >
              <option value="">选择到达地点</option>
              {places.map((p) => (
                <option key={String(p.key)} value={String(p.key)}>
                  {String(p.name || '待命名地点')}
                </option>
              ))}
            </select>
          </label>
          <label className={s.formField}>
            移动耗时（分钟，最多 120）
            <input
              type="number"
              className={s.input}
              disabled={disabled}
              min={1}
              max={120}
              step={1}
              value={typeof route.minutes === 'number' ? route.minutes : ''}
              onChange={(event) => updateRoute(index, { minutes: Number(event.target.value) })}
            />
          </label>
          <button
            type="button"
            className={s.btn}
            disabled={disabled}
            onClick={() => {
              if (!disabled) onChange({ ...content, routes: routes.filter((_, i) => i !== index) });
            }}
          >
            移除这条路线
          </button>
        </div>
      ))}
      <button
        type="button"
        className={s.btn}
        disabled={disabled || places.length < 2 || routes.length >= 64}
        onClick={() => {
          if (!disabled && places.length > 1 && routes.length < 64)
            onChange({
              ...content,
              routes: [
                ...routes,
                { fromPlaceKey: places[0]!.key, toPlaceKey: places[1]!.key, minutes: 0 },
              ],
            });
        }}
      >
        添加单向路线
      </button>
    </section>
  );
}
