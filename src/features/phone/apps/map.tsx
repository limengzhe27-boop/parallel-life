'use client';

import { useEffect, useRef, useState } from 'react';
import type { WorldSpace } from '../../../contracts/world-space.ts';
import { worldDateTimeLabel, worldTimeLabel } from '../../../modules/world/domain/display-time.ts';
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
  const [readError, setReadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyAction, setBusyAction] = useState<'establish' | 'enter' | 'travel' | null>(null);
  const acting = useRef(false);
  const showFeedback = useRef(false);
  const feedbackElement = useRef<HTMLDivElement>(null);
  const detailsElement = useRef<HTMLElement>(null);
  const feedback = mapFeedback(worldId, map?.operation ?? null);
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

  const space = map?.data?.worldId === worldId ? map.data : null;
  const { current, selected, route, arrival } = space
    ? mapSelection(space, selectedId)
    : { current: null, selected: null, route: undefined, arrival: '' };
  const error = map?.error || readError;
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
      actionError ||
      space.paused ||
      space.busy ||
      operation ||
      acting.current
    )
      return;
    if (kind === 'establish' && !space.canEstablish) return;
    if (kind === 'enter' && (!current || selected?.id !== current.id)) return;
    acting.current = true;
    setBusyAction(kind);
    try {
      if (kind === 'establish') await map.establish();
      else {
        await map.enterPlace(current!.id);
        // The controller opens the exact resulting scene; do not overwrite its route.
      }
    } catch {
      setActionError('暂时没能确认这次操作，请刷新查看结果。');
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
      actionError ||
      space.paused ||
      space.busy ||
      operation ||
      acting.current
    )
      return;
    acting.current = true;
    showFeedback.current = true;
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
      current?.id !== operation.receipt.toPlaceId
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
  return (
    <div className={s.page} data-phone-map>
      <header className={s.header}>
        <div>
          <p className={s.eyebrow}>世界内已知地点</p>
          {space && (
            <time dateTime={space.storyNow}>
              {waitingPosition && operation?.receipt
                ? worldDateTimeLabel(operation.receipt.arrivedAt)
                : worldDateTimeLabel(space.storyNow)}
            </time>
          )}
        </div>
        {map && (
          <button
            type="button"
            className={s.refresh}
            disabled={map.loading}
            onClick={() => void refresh()}
            aria-label="刷新地点"
          >
            ↻
          </button>
        )}
      </header>
      {map?.loading && (
        <p className={s.notice} role="status">
          正在更新地点…
        </p>
      )}
      {actionError && (
        <p className={s.error} role="alert">
          {actionError}
        </p>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
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
              !map.loading &&
              !error
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
              !error
                ? () => {
                    void map.resubmitTravel().catch(() => {});
                  }
                : undefined
            }
            onContinue={
              feedback.status === 'committed' &&
              !waitingPosition &&
              current?.id === operation?.receipt?.toPlaceId
                ? continueAtPlace
                : undefined
            }
            continueLabel="查看这个地点"
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
          <span aria-hidden="true">⌖</span>
          <h2>这段人生还没有可用地点</h2>
          <p>已知地点出现后，会在这里显示。</p>
          {space?.canEstablish && (
            <>
              <p>可以使用这段人生起点中已设定的地点。</p>
              <button
                type="button"
                className={s.primary}
                disabled={Boolean(
                  map?.loading ||
                  map?.working ||
                  error ||
                  actionError ||
                  space.paused ||
                  space.busy ||
                  operation ||
                  busyAction,
                )}
                onClick={() => void placeAction('establish')}
              >
                {busyAction === 'establish' ? '正在确认…' : '使用起点中的地点'}
              </button>
            </>
          )}
        </div>
      ) : !space ? (
        <div className={s.empty}>
          <h2>{map?.loading ? '正在打开地图…' : '暂时读不到地点'}</h2>
        </div>
      ) : (
        <>
          <section className={s.location} aria-label="当前位置">
            <span className={s.currentDot} aria-hidden="true" />
            <div>
              <p className={s.eyebrow}>你现在在</p>
              <h2>{waitingPosition ? '正在更新当前位置' : current?.name || '位置尚未确认'}</h2>
            </div>
          </section>
          <section className={s.diagram} aria-label="地点示意">
            <span className={s.diagramLabel}>地点示意</span>
            <div className={s.points}>
              {space.places.map((place) => (
                <button
                  type="button"
                  key={place.id}
                  className={place.id === selected?.id ? s.selectedPoint : s.point}
                  aria-pressed={place.id === selected?.id}
                  onClick={() => selectPlace(place.id)}
                >
                  <span
                    className={place.id === current?.id && !waitingPosition ? s.currentPin : s.pin}
                    aria-hidden="true"
                  >
                    ●
                  </span>
                  <span>{place.name}</span>
                  {place.id === current?.id && !waitingPosition && <small>当前位置</small>}
                </button>
              ))}
            </div>
          </section>
          <section className={s.destinations} aria-label="选择目的地">
            <h2 className={s.sectionTitle}>想去哪里</h2>
            {space.places
              .filter((place) => place.id !== current?.id)
              .map((place) => {
                const knownRoute =
                  current &&
                  space.routes.find(
                    (r) => r.fromPlaceId === current.id && r.toPlaceId === place.id,
                  );
                return (
                  <button
                    type="button"
                    className={s.destination}
                    key={place.id}
                    aria-pressed={selected?.id === place.id}
                    onClick={() => selectPlace(place.id)}
                  >
                    <span className={s.destinationIcon} aria-hidden="true">
                      ⌖
                    </span>
                    <span className={s.destinationName}>{place.name}</span>
                    <small>
                      {knownRoute ? `${knownRoute.durationMinutes} 分钟` : '路线未建立'}
                    </small>
                    <span className={s.chevron} aria-hidden="true">
                      ›
                    </span>
                  </button>
                );
              })}
            {space.places.every((place) => place.id === current?.id) && (
              <p className={s.muted}>还没有其他已知地点。</p>
            )}
          </section>
          {selected && (
            <section
              className={s.details}
              ref={detailsElement}
              tabIndex={-1}
              aria-label={`${selected.name}详情`}
            >
              <h2>{selected.name}</h2>
              {route && arrival && !operation && (
                <div className={s.routeSummary}>
                  <strong>{route.durationMinutes} 分钟</strong>
                  <span>
                    {route.modeLabel} · 约{' '}
                    {arrival.slice(0, 10) === worldDateTimeLabel(space.storyNow).slice(0, 10)
                      ? worldTimeLabel(
                          new Date(
                            Date.parse(space.storyNow) + route.durationMinutes * 60_000,
                          ).toISOString(),
                        )
                      : arrival}{' '}
                    到达
                  </span>
                </div>
              )}
              {selected.description && <p className={s.description}>{selected.description}</p>}
              <p className={s.source}>
                {selected.source.kind === 'world_event'
                  ? '已确认的地点记录 · 来源于人生起点'
                  : '来自这段人生的作者设定'}
              </p>
              {!current && <p className={s.muted}>确认当前位置后才能前往。</p>}
              {current && selected.id !== current.id && !route && (
                <p className={s.muted}>暂时没有可用路线。</p>
              )}
              {space.paused && <p className={s.muted}>这段人生已暂停。</p>}
              {space.busy && <p className={s.muted}>这段人生正在处理中，稍后再前往。</p>}
              {current?.id === selected.id && !operation && (
                <button
                  type="button"
                  className={s.primary}
                  disabled={Boolean(
                    map?.loading ||
                    map?.working ||
                    error ||
                    actionError ||
                    space.paused ||
                    space.busy ||
                    busyAction,
                  )}
                  onClick={() => void placeAction('enter')}
                >
                  {busyAction === 'enter' ? '正在打开…' : '看看这里'}
                </button>
              )}
              {route && !operation && (
                <button
                  type="button"
                  className={s.primary}
                  disabled={Boolean(
                    !arrival ||
                    map?.loading ||
                    map?.working ||
                    error ||
                    actionError ||
                    space.paused ||
                    space.busy ||
                    busyAction,
                  )}
                  onClick={() => void startTravel()}
                >
                  {busyAction === 'travel' ? '正在确认行程…' : '前往这里'}
                </button>
              )}
              {contacts.length > 0 && (
                <nav className={s.actions} aria-label="相关联系人">
                  {contacts.map((contact) => (
                    <button
                      type="button"
                      key={contact.id}
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
                      type="button"
                      key={appointment.id}
                      onClick={() => open('calendar', appointment.id)}
                    >
                      查看{appointment.title}
                      <span aria-hidden="true">↗</span>
                    </button>
                  ))}
                </nav>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
