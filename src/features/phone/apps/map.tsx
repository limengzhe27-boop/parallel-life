'use client';

import { useEffect, useRef, useState } from 'react';
import type { WorldSpace } from '../../../contracts/world-space.ts';
import { worldDateTimeLabel } from '../../../modules/world/domain/display-time.ts';
import type { PhoneAppContext } from '../phone-shell.tsx';
import type { TravelOperation } from '../map/context.ts';
import { TravelFeedback } from '../map/travel-feedback.tsx';
import type { TravelFeedbackState } from '../map/travel-presentation.ts';
import { usePhoneApps } from './provider.tsx';
import s from './map.module.css';

/** Preview uses the published world clock and authored route, never device time or map distance. */
export function mapSelection(data: WorldSpace, placeId?: string) {
  const current = data.places.find((place) => place.id === data.currentPlaceId) ?? null;
  const selected = data.places.find((place) => place.id === placeId) ?? current;
  const route =
    current && selected && current.id !== selected.id
      ? data.routes.find(
          (route) => route.fromPlaceId === current.id && route.toPlaceId === selected.id,
        )
      : undefined;
  const validClock = Boolean(worldDateTimeLabel(data.storyNow));
  const arrival =
    route && validClock
      ? worldDateTimeLabel(
          new Date(Date.parse(data.storyNow) + route.durationMinutes * 60_000).toISOString(),
        )
      : '';
  return { current, selected, route, arrival };
}

/** Logical layout only. Every line retains an actual published route and known stable endpoints. */
export function mapDiagram(data: WorldSpace) {
  const visible = data.places.slice(0, 16);
  const current = data.places.find((place) => place.id === data.currentPlaceId);
  if (current && !visible.some((place) => place.id === current.id))
    visible[visible.length - 1] = current;
  const columns = visible.length <= 4 ? 2 : visible.length <= 9 ? 3 : 4;
  const rows = Math.max(1, Math.ceil(visible.length / columns));
  const points = visible.map((place, index) => ({
    place,
    x: (((index % columns) + 0.5) * 320) / columns,
    y: Math.floor(index / columns) * 100 + 32,
  }));
  const edges = data.routes.flatMap((route) => {
    const from = points.find((point) => point.place.id === route.fromPlaceId);
    const to = points.find((point) => point.place.id === route.toPlaceId);
    return from && to && from.place.id !== to.place.id ? [{ route, from, to }] : [];
  });
  return { points, edges, height: rows * 100 + 24, partial: data.places.length > visible.length };
}

/** The persisted controller is the only command owner; absent or mismatched receipts stay unknown. */
export function mapFeedback(
  worldId: string,
  operation: TravelOperation | null,
): TravelFeedbackState {
  if (!operation) return { status: 'idle' };
  if (operation.status !== 'committed')
    return {
      status: operation.status,
      destinationLabel: operation.destinationLabel,
      message: operation.message,
    };
  const receipt = operation.receipt;
  if (
    !receipt ||
    receipt.worldId !== worldId ||
    receipt.commandId !== operation.request.commandId ||
    receipt.routeId !== operation.request.routeId ||
    receipt.version !== operation.request.expectedVersion + 1 ||
    !worldDateTimeLabel(receipt.arrivedAt)
  ) {
    return {
      status: 'unknown',
      destinationLabel: operation.destinationLabel,
      message: '到达结果还需要核对。',
    };
  }
  return {
    status: 'committed',
    arrival: {
      fromLabel: receipt.fromLabel,
      destinationLabel: receipt.destinationLabel,
      durationMinutes: receipt.durationMinutes,
      arrivedAtLabel: worldDateTimeLabel(receipt.arrivedAt),
    },
  };
}

// A view selection cache only: no world state, command, receipt, or production repository.
const selectedPlaces = new Map<string, string>();

export function MapApp({ map: providedMap, target, open }: PhoneAppContext) {
  const { worldId, data: phone } = usePhoneApps();
  const map =
    providedMap && (!providedMap.data || providedMap.data.worldId === worldId)
      ? providedMap
      : undefined;
  const controller = useRef(map);
  controller.current = map;
  const [selectedId, select] = useState<string | undefined>(
    () => target ?? selectedPlaces.get(worldId),
  );
  useEffect(() => {
    if (target) {
      select(target);
      selectedPlaces.set(worldId, target);
    }
  }, [target, worldId]);
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isGesturing, setIsGesturing] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduceMotion(preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  const touchStartDist = useRef<number | null>(null);
  const touchStartZoom = useRef<number>(1);
  const touchStartPoint = useRef<{ x: number; y: number } | null>(null);
  const touchStartPan = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastTapTime = useRef<number>(0);
  const [readError, setReadError] = useState('');
  const [actionError, setActionError] = useState('');
  const error = map?.error || readError;
  const [busyAction, setBusyAction] = useState<'establish' | 'enter' | 'travel' | null>(null);
  const acting = useRef(false);
  const showFeedback = useRef(false);
  const feedbackElement = useRef<HTMLDivElement>(null);
  const detailsElement = useRef<HTMLElement>(null);
  const feedback: TravelFeedbackState = mapFeedback(worldId, map?.operation ?? null);
  const operation = map?.operation;
  const waitingPosition =
    feedback.status === 'committed' &&
    Boolean(
      operation?.receipt && (!map?.data || map.data.worldVersion < operation.receipt.version),
    );
  useEffect(() => {
    if (showFeedback.current && feedback.status !== 'idle') {
      feedbackElement.current?.scrollIntoView({ block: 'nearest' });
      showFeedback.current = false;
    }
  }, [feedback.status]);

  const space = !error && map?.data?.worldId === worldId ? map.data : null;
  const { current, selected, route, arrival } = space
    ? mapSelection(space, selectedId)
    : { current: null, selected: null, route: undefined, arrival: '' };
  const diagram = space ? mapDiagram(space) : null;
  const targetAvailable = !target || !space || space.places.some((place) => place.id === target);
  useEffect(() => {
    if (!target || !space || !targetAvailable || selected?.id !== target) return;
    const frame = requestAnimationFrame(() =>
      detailsElement.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [target, targetAvailable, selected?.id, space?.worldVersion]);
  const unavailable = !map || (!space && !map.loading && !error);
  async function refresh() {
    if (!map || map.loading) return;
    setReadError('');
    try {
      await map.refresh();
      setActionError('');
    } catch {
      setReadError('暂时读不到地点，请稍后再试。');
    }
  }
  async function placeAction(kind: 'establish' | 'enter') {
    if (
      !map ||
      !space ||
      map.loading ||
      map.working ||
      error ||
      ((space.paused || space.busy) && !(kind === 'enter' && space.currentSceneId)) ||
      operation ||
      acting.current
    )
      return;
    if (kind === 'establish' && !space.canEstablish) return;
    if (kind === 'enter' && (!current || selected?.id !== current.id)) return;
    acting.current = true;
    setActionError('');
    setBusyAction(kind);
    try {
      if (kind === 'establish') await map.establish();
      else {
        await map.enterPlace(current!.id);
        // The controller opens the exact resulting scene; do not overwrite its route.
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '暂时没能确认这次操作，请刷新查看结果。');
    } finally {
      acting.current = false;
      setBusyAction(null);
    }
  }
  async function startTravel() {
    if (
      !map ||
      !space ||
      !route ||
      !arrival ||
      map.loading ||
      map.working ||
      error ||
      space.paused ||
      space.busy ||
      operation ||
      acting.current
    )
      return;
    acting.current = true;
    showFeedback.current = true;
    setActionError('');
    setBusyAction('travel');
    try {
      await map.travel({
        commandId: crypto.randomUUID(),
        expectedVersion: space.worldVersion,
        routeId: route.id,
      });
    } catch {
      // Durable operation errors stay with the controller; a preflight rejection has no receipt.
      if (!controller.current?.operation) setActionError('这次没能提交行程，请刷新后再选择。');
    } finally {
      acting.current = false;
      setBusyAction(null);
    }
  }
  function continueAtPlace() {
    if (
      !map ||
      feedback.status !== 'committed' ||
      !operation?.receipt ||
      waitingPosition ||
      !current ||
      map.working ||
      map.checking
    )
      return;
    selectedPlaces.set(worldId, current.id);
    select(current.id);
    map.clearTravel();
    requestAnimationFrame(() => {
      detailsElement.current?.focus({ preventScroll: true });
      detailsElement.current?.scrollIntoView({ block: 'nearest' });
    });
  }
  useEffect(() => {
    if (
      feedback.status === 'committed' &&
      !waitingPosition &&
      !map?.working &&
      !map?.checking &&
      operation?.receipt &&
      current
    ) {
      const timer = setTimeout(
        () => {
          continueAtPlace();
        },
        reduceMotion ? 0 : 1400,
      );
      return () => clearTimeout(timer);
    }
  }, [
    feedback.status,
    waitingPosition,
    current?.id,
    operation?.receipt,
    reduceMotion,
    map?.working,
    map?.checking,
  ]);

  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0]!.clientX - e.touches[1]!.clientX,
        e.touches[0]!.clientY - e.touches[1]!.clientY,
      );
      touchStartDist.current = dist;
      touchStartZoom.current = zoomScale;
      setIsGesturing(true);
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTapTime.current < 300) {
        setZoomScale((z) => (z > 1.15 ? 1 : 1.3));
        setPanOffset({ x: 0, y: 0 });
        lastTapTime.current = 0;
      } else {
        lastTapTime.current = now;
      }
      if (zoomScale > 1.05) {
        touchStartPoint.current = {
          x: e.touches[0]!.clientX,
          y: e.touches[0]!.clientY,
        };
        touchStartPan.current = { ...panOffset };
        setIsGesturing(true);
      }
    }
  }

  function handleTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (e.touches.length === 2 && touchStartDist.current && touchStartDist.current > 0) {
      const currentDist = Math.hypot(
        e.touches[0]!.clientX - e.touches[1]!.clientX,
        e.touches[0]!.clientY - e.touches[1]!.clientY,
      );
      const ratio = currentDist / touchStartDist.current;
      const nextZoom = Math.min(
        1.5,
        Math.max(0.8, Number((touchStartZoom.current * ratio).toFixed(2))),
      );
      setZoomScale(nextZoom);
    } else if (e.touches.length === 1 && touchStartPoint.current && zoomScale > 1.05) {
      const dx = e.touches[0]!.clientX - touchStartPoint.current.x;
      const dy = e.touches[0]!.clientY - touchStartPoint.current.y;
      const maxPanX = Math.round((zoomScale - 1) * 100);
      const maxPanY = Math.round((zoomScale - 1) * 60);
      setPanOffset({
        x: Math.min(maxPanX, Math.max(-maxPanX, touchStartPan.current.x + dx)),
        y: Math.min(maxPanY, Math.max(-maxPanY, touchStartPan.current.y + dy)),
      });
    }
  }

  function handleTouchEnd() {
    touchStartDist.current = null;
    touchStartPoint.current = null;
    setIsGesturing(false);
  }

  function selectPlace(placeId: string) {
    if (selectedPlaces.size >= 32 && !selectedPlaces.has(worldId))
      selectedPlaces.delete(selectedPlaces.keys().next().value!);
    selectedPlaces.set(worldId, placeId);
    select(placeId);
    requestAnimationFrame(() => detailsElement.current?.scrollIntoView({ block: 'nearest' }));
  }
  const contacts = selected
    ? phone.contacts.filter((contact) => selected.contactActorIds.includes(contact.id))
    : [];
  const appointments = selected
    ? phone.invitations.filter((invitation) => selected.appointmentIds.includes(invitation.id))
    : [];
  const blocked = Boolean(map?.loading || map?.working || error || busyAction);
  const entryBlocked = blocked || Boolean(!space?.currentSceneId && (space?.paused || space?.busy));
  function resetMap() {
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
    if (current) selectPlace(current.id);
  }
  return (
    <div className={s.page} data-phone-map>
      <header className={s.header}>
        <div className={s.location} aria-label="当前位置">
          <span className={s.currentDot} aria-hidden="true" />
          <div>
            <p className={s.eyebrow}>你现在在</p>
            <h2>{waitingPosition ? '正在更新当前位置' : current?.name || '位置尚未确认'}</h2>
          </div>
        </div>
        <button
          type="button"
          className={s.iconButton}
          disabled={map?.loading}
          onClick={() => void refresh()}
          aria-label="刷新地点"
        >
          <MapIcon name="refresh" />
        </button>
      </header>
      {(error || actionError) && (
        <div className={s.error} role="alert">
          <p>{error || actionError}</p>
          <button type="button" disabled={map?.loading} onClick={() => void refresh()}>
            刷新查看
          </button>
        </div>
      )}
      {map?.loading && (
        <p className={s.notice} role="status">
          正在更新地点…
        </p>
      )}
      {feedback.status !== 'idle' && (
        <div className={s.travel} ref={feedbackElement}>
          <TravelFeedback
            state={feedback}
            checking={Boolean(map?.checking || map?.working)}
            onCheckResult={
              map
                ? () => {
                    void map.checkTravel().catch(() => {});
                  }
                : undefined
            }
            onRetry={
              map &&
              feedback.status === 'failed' &&
              space &&
              !space.paused &&
              !space.busy &&
              !blocked
                ? () => {
                    void map.retryTravel().catch(() => {});
                  }
                : undefined
            }
            onResubmitOriginal={
              map &&
              space &&
              operation?.status === 'unknown' &&
              operation.recoveryUnconfirmed &&
              !space.paused &&
              !space.busy &&
              !blocked
                ? () => {
                    void map.resubmitTravel().catch(() => {});
                  }
                : undefined
            }
            onContinue={
              feedback.status === 'committed' && !waitingPosition && current && !map?.working
                ? continueAtPlace
                : undefined
            }
            continueLabel={
              current?.id === operation?.receipt?.toPlaceId ? '查看这个地点' : '返回当前地点'
            }
          />
          {feedback.status === 'failed' && map && (
            <button
              className={s.clear}
              type="button"
              disabled={map.working || map.checking}
              onClick={() => map.clearTravel()}
            >
              重新选地点
            </button>
          )}
          {waitingPosition && (
            <p className={s.muted} role="status">
              正在核对当前位置，请刷新查看。
            </p>
          )}
        </div>
      )}
      {unavailable || (space && space.places.length === 0) ? (
        <div className={s.empty}>
          <MapIcon name="pin" />
          <h2>这段人生还没有可用地点</h2>
          <p>已知地点出现后，会在这里显示。</p>
          {space?.canEstablish && (
            <button
              type="button"
              className={s.primary}
              disabled={Boolean(blocked || space.paused || space.busy || operation)}
              onClick={() => void placeAction('establish')}
            >
              {busyAction === 'establish' ? '正在确认…' : '使用起点中的地点'}
            </button>
          )}
        </div>
      ) : !space ? (
        <div className={s.empty}>
          <h2>{map?.loading ? '正在打开地图…' : '暂时读不到地点'}</h2>
        </div>
      ) : (
        <>
          {!targetAvailable && (
            <p className={s.notice} role="status">
              原记录中的地点暂时不可用。下方展示当前已知地点，请重新选择。
            </p>
          )}
          {diagram && (
            <section className={s.diagram} aria-label="地点示意">
              <div className={s.mapViewport}>
                <div
                  className={s.graph}
                  style={{
                    height: Math.max(300, diagram.height + 56),
                    transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
                    transition: isGesturing || reduceMotion ? 'none' : undefined,
                  }}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  onTouchCancel={handleTouchEnd}
                >
                  <svg
                    className={s.basemap}
                    viewBox="0 0 400 400"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <path
                      className={s.park}
                      d="M0 10H82V90H20V142H0ZM288 232H368V365H296V322H270V264Z"
                    />
                    <path
                      className={s.blocks}
                      d="M102 12h61v55h-61zM187 12h60v82h-60zM273 14h65v67h-65zM24 171h55v65H24zM99 127h49v91H99zM174 124h70v48h-70zM176 199h68v42h-68zM24 267h73v86H24zM122 273h55v58h-55zM202 273h46v92h-46zM294 113h72v90h-72z"
                    />
                    <path
                      className={s.streets}
                      d="M0 108H400M0 254H400M88 0V400M260 0V400M354 0V220"
                    />
                    <path
                      className={s.lanes}
                      d="M0 157H88M166 0V254M88 232H260M112 400V254M188 254V400"
                    />
                  </svg>
                  <svg
                    className={s.lines}
                    viewBox={`0 0 320 ${Math.max(300, diagram.height + 56)}`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    {diagram.edges
                      .filter(({ route: edge }) => edge.id === route?.id)
                      .map(({ route: edge, from, to }) => (
                        <path
                          key={edge.id}
                          data-known-route={edge.id}
                          className={s.selectedLine}
                          d={`M${from.x} ${from.y + 52} H${(from.x + to.x) / 2} V${to.y + 52} H${to.x}`}
                        />
                      ))}
                  </svg>
                  {diagram.points.map(({ place, x, y }) => (
                    <button
                      key={place.id}
                      type="button"
                      aria-label={`选择地点：${place.name}`}
                      aria-pressed={place.id === selected?.id}
                      className={place.id === selected?.id ? s.selectedPoint : s.point}
                      style={{ left: `${(x / 320) * 100}%`, top: y + 52 }}
                      onClick={() => selectPlace(place.id)}
                    >
                      <span
                        className={
                          place.id === current?.id && !waitingPosition ? s.currentPin : s.pin
                        }
                        aria-hidden="true"
                      >
                        <MapIcon name="pin" />
                      </span>
                      <span className={s.pointLabel}>{place.name}</span>
                      {place.id === current?.id && !waitingPosition && <small>当前位置</small>}
                    </button>
                  ))}
                </div>
                <div className={s.tools} aria-label="地图辅助控制">
                  <button
                    type="button"
                    className={s.iconButton}
                    aria-label="放大地图"
                    disabled={zoomScale >= 1.6}
                    onClick={() => setZoomScale((z) => Math.min(1.6, z + 0.2))}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className={s.iconButton}
                    aria-label="缩小地图"
                    disabled={zoomScale <= 1}
                    onClick={() => {
                      setZoomScale((z) => Math.max(1, z - 0.2));
                      setPanOffset({ x: 0, y: 0 });
                    }}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className={s.iconButton}
                    aria-label="回到当前地点"
                    onClick={resetMap}
                  >
                    <MapIcon name="locate" />
                  </button>
                </div>
                <span className={s.diagramLabel}>地点示意 · 非地理距离</span>
              </div>
            </section>
          )}
          <div className={s.sheet}>
            <span className={s.handle} aria-hidden="true" />
            {selected && (
              <section
                className={s.details}
                ref={detailsElement}
                tabIndex={-1}
                aria-label={`${selected.name}详情`}
              >
                <div className={s.detailHeading}>
                  <div>
                    <p className={s.eyebrow}>
                      {current?.id === selected.id ? '当前地点' : '目的地'}
                    </p>
                    <h2>{selected.name}</h2>
                  </div>
                  <span className={s.placeIcon} aria-hidden="true">
                    <MapIcon name="pin" />
                  </span>
                </div>
                {route && arrival && !operation && (
                  <div className={s.routeSummary}>
                    <strong>
                      {route.durationMinutes} <small>分钟</small>
                    </strong>
                    <span>
                      {route.modeLabel} · 约{' '}
                      {arrival.slice(0, 10) === worldDateTimeLabel(space.storyNow).slice(0, 10)
                        ? arrival.slice(11, 16)
                        : arrival}{' '}
                      到达
                    </span>
                  </div>
                )}
                {selected.description && <p className={s.description}>{selected.description}</p>}
                {!current && <p className={s.muted}>确认当前位置后才能前往。</p>}
                {current && selected.id !== current.id && !route && (
                  <p className={s.muted}>暂时没有可用路线。</p>
                )}
                {space.paused && <p className={s.muted}>这段人生已暂停。</p>}
                {space.busy && (
                  <p className={s.muted}>
                    {space.currentSceneId
                      ? '有待处理的操作，可以先回到现场查看。'
                      : '这段人生正在处理中，稍后再前往。'}
                  </p>
                )}
                {current?.id === selected.id && !operation && (
                  <button
                    type="button"
                    className={s.primary}
                    disabled={entryBlocked}
                    onClick={() => void placeAction('enter')}
                  >
                    {busyAction === 'enter'
                      ? '正在打开…'
                      : space.currentSceneId
                        ? '看看这里（回到现场）'
                        : '看看这里（进入现场）'}
                  </button>
                )}
                {route && !operation && (
                  <button
                    type="button"
                    className={s.primary}
                    disabled={Boolean(!arrival || blocked || space.paused || space.busy)}
                    onClick={() => void startTravel()}
                  >
                    {busyAction === 'travel' ? '正在确认行程…' : '前往这里'}
                  </button>
                )}
                {(contacts.length > 0 || appointments.length > 0) && (
                  <div className={s.links}>
                    {contacts.length > 0 && (
                      <nav className={s.actions} aria-label="相关联系人">
                        {contacts.map((contact) => (
                          <button
                            key={contact.id}
                            type="button"
                            onClick={() => open('messages', contact.id)}
                          >
                            联系{contact.name}
                            <span aria-hidden="true">↗</span>
                          </button>
                        ))}
                      </nav>
                    )}
                    {appointments.length > 0 && (
                      <nav className={s.actions} aria-label="关联日程">
                        {appointments.map((appointment) => (
                          <button
                            key={appointment.id}
                            type="button"
                            onClick={() => open('calendar', appointment.id)}
                          >
                            查看{appointment.title}
                            <span aria-hidden="true">↗</span>
                          </button>
                        ))}
                      </nav>
                    )}
                  </div>
                )}
                <p className={s.source}>
                  {selected.source.kind === 'world_event'
                    ? '来自已确认的地点记录'
                    : '来自这段人生的作者设定'}
                </p>
              </section>
            )}
            <section className={s.destinations} aria-label="选择目的地">
              <div className={s.listHeading}>
                <h2>已知地点</h2>
                <span>{space.places.length} 处</span>
              </div>
              {space.places.map((place) => {
                const knownRoute =
                  current &&
                  space.routes.find(
                    (r) => r.fromPlaceId === current.id && r.toPlaceId === place.id,
                  );
                return (
                  <button
                    key={place.id}
                    type="button"
                    className={s.destination}
                    aria-pressed={selected?.id === place.id}
                    onClick={() => selectPlace(place.id)}
                  >
                    <span className={s.destinationIcon} aria-hidden="true">
                      <MapIcon name="pin" />
                    </span>
                    <span className={s.destinationName}>{place.name}</span>
                    <small>
                      {place.id === current?.id
                        ? '当前位置'
                        : knownRoute
                          ? `${knownRoute.durationMinutes} 分钟`
                          : '路线未建立'}
                    </small>
                    <span aria-hidden="true">›</span>
                  </button>
                );
              })}
              {space.places.every((place) => place.id === current?.id) && (
                <p className={s.muted}>还没有其他已知地点。</p>
              )}
            </section>
            <time className={s.worldTime} dateTime={space.storyNow}>
              {worldDateTimeLabel(space.storyNow)}
            </time>
          </div>
        </>
      )}
    </div>
  );
}

function MapIcon({ name }: { name: 'pin' | 'locate' | 'refresh' }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === 'pin' ? (
        <>
          <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
          <circle cx="12" cy="10" r="2.4" />
        </>
      ) : name === 'locate' ? (
        <>
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2" />
          <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
        </>
      ) : (
        <>
          <path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2" />
        </>
      )}
    </svg>
  );
}
