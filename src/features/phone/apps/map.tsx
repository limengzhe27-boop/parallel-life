'use client';

import { useEffect, useId, useRef, useState } from 'react';
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
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [activeCategory, setActiveCategory] = useState<'food' | 'pharmacy' | 'park' | 'wc' | null>(
    null,
  );
  const [mapTheme, setMapTheme] = useState<'standard' | 'transit'>('standard');
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isGesturing, setIsGesturing] = useState(false);
  const touchStartDist = useRef<number | null>(null);
  const touchStartZoom = useRef<number>(1);
  const touchStartPoint = useRef<{ x: number; y: number } | null>(null);
  const touchStartPan = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastTapTime = useRef<number>(0);
  const [readError, setReadError] = useState('');
  const [actionError, setActionError] = useState('');
  const error = map?.error || readError;
  const routeArrow = useId();
  const [busyAction, setBusyAction] = useState<'establish' | 'enter' | 'travel' | null>(null);
  const acting = useRef(false);
  const showFeedback = useRef(false);
  const feedbackElement = useRef<HTMLDivElement>(null);
  const detailsElement = useRef<HTMLElement>(null);
  const feedback: TravelFeedbackState = error
    ? { status: 'idle' }
    : mapFeedback(worldId, map?.operation ?? null);
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
  useEffect(() => {
    if (
      feedback.status === 'committed' &&
      !waitingPosition &&
      operation?.receipt &&
      current?.id === operation.receipt.toPlaceId
    ) {
      const timer = setTimeout(() => {
        continueAtPlace();
      }, 1400);
      return () => clearTimeout(timer);
    }
  }, [feedback.status, waitingPosition, current?.id, operation?.receipt]);

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
  const filteredPlaces = space
    ? space.places.filter((place) => {
        if (searchQuery.trim()) {
          const q = searchQuery.trim().toLowerCase();
          return (
            place.name.toLowerCase().includes(q) ||
            Boolean(place.description && place.description.toLowerCase().includes(q))
          );
        }
        if (activeCategory === 'food') {
          return /餐|吃|饭|店|馆|食|酒|茶|咖/.test(
            place.name + (place.description || ''),
          );
        }
        if (activeCategory === 'pharmacy') {
          return /药|医|院|急救|诊所|康/.test(
            place.name + (place.description || ''),
          );
        }
        if (activeCategory === 'park') {
          return /园|湖|林|绿|树|山|草/.test(
            place.name + (place.description || ''),
          );
        }
        if (activeCategory === 'wc') {
          return /公厕|卫|洗手|厕/.test(place.name + (place.description || ''));
        }
        return true;
      })
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
          <div className={s.searchBarContainer}>
            <div className={`${s.searchBar} ${searchActive ? s.searchBarFocused : ''}`}>
              <button
                type="button"
                className={s.searchBack}
                onClick={() => {
                  setSearchQuery('');
                  setSearchActive(false);
                  searchInputRef.current?.blur();
                  if (current) selectPlace(current.id);
                }}
                aria-label="重置路线"
              >
                ‹
              </button>
              <div className={s.citySelector}>
                <span className={s.cityName}>这段人生</span>
                <span className={s.cityDivider}>|</span>
              </div>
              <input
                ref={searchInputRef}
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className={s.searchInput}
                placeholder="搜地点、查路线"
                value={searchQuery}
                onFocus={() => setSearchActive(true)}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!searchActive) setSearchActive(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    searchInputRef.current?.blur();
                  }
                }}
                aria-label="搜索已知地点"
              />
              {searchQuery ? (
                <button
                  type="button"
                  className={s.clearSearchBtn}
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  aria-label="清空输入"
                >
                  ×
                </button>
              ) : null}
              <span className={s.searchGlass} aria-hidden="true">
                🔍
              </span>
              {searchActive && (
                <button
                  type="button"
                  className={s.cancelSearchBtn}
                  onClick={() => {
                    setSearchQuery('');
                    setSearchActive(false);
                    searchInputRef.current?.blur();
                  }}
                  aria-label="取消搜索"
                >
                  取消
                </button>
              )}
            </div>
          </div>
          {searchActive ? (
            <section
              className={s.searchOverlay}
              aria-label="搜索结果"
              onTouchStart={() => searchInputRef.current?.blur()}
              onScroll={() => searchInputRef.current?.blur()}
            >
              <div className={s.searchResultHeader}>
                <span className={s.searchResultCount}>
                  {filteredPlaces.length > 0
                    ? `找到 ${filteredPlaces.length} 个相关已知地点`
                    : searchQuery.trim()
                      ? '未找到相关已知地点'
                      : '全部已知地点'}
                </span>
                {searchQuery && (
                  <button
                    type="button"
                    className={s.clearTextLink}
                    onClick={() => {
                      setSearchQuery('');
                      searchInputRef.current?.focus();
                    }}
                  >
                    清空输入
                  </button>
                )}
              </div>
              {!searchQuery.trim() && (
                <div className={s.categoryGrid} role="group" aria-label="地点快捷分类">
                  <button
                    type="button"
                    className={`${s.catBtn} ${activeCategory === 'food' ? s.catBtnActive : ''}`}
                    onClick={() => setActiveCategory((c) => (c === 'food' ? null : 'food'))}
                  >
                    <span className={`${s.catBadge} ${s.catFood}`}>餐</span>
                    <span className={s.catText}>美食</span>
                  </button>
                  <button
                    type="button"
                    className={`${s.catBtn} ${activeCategory === 'pharmacy' ? s.catBtnActive : ''}`}
                    onClick={() => setActiveCategory((c) => (c === 'pharmacy' ? null : 'pharmacy'))}
                  >
                    <span className={`${s.catBadge} ${s.catMed}`}>+</span>
                    <span className={s.catText}>药店</span>
                  </button>
                  <button
                    type="button"
                    className={`${s.catBtn} ${activeCategory === 'park' ? s.catBtnActive : ''}`}
                    onClick={() => setActiveCategory((c) => (c === 'park' ? null : 'park'))}
                  >
                    <span className={`${s.catBadge} ${s.catPark}`}>叶</span>
                    <span className={s.catText}>公园</span>
                  </button>
                  <button
                    type="button"
                    className={`${s.catBtn} ${activeCategory === 'wc' ? s.catBtnActive : ''}`}
                    onClick={() => setActiveCategory((c) => (c === 'wc' ? null : 'wc'))}
                  >
                    <span className={`${s.catBadge} ${s.catWc}`}>WC</span>
                    <span className={s.catText}>公厕</span>
                  </button>
                </div>
              )}
              {filteredPlaces.length === 0 ? (
                <div className={s.searchEmpty}>
                  <p className={s.searchEmptyTitle}>未找到与“{searchQuery.trim()}”相关的已知地点</p>
                  <p className={s.searchEmptyHint}>可核对地点全称，或点击右上角“取消”查看全部地图。</p>
                </div>
              ) : (
                <div className={s.searchResultList}>
                  {filteredPlaces.map((place) => {
                    const knownRoute =
                      current &&
                      space.routes.find(
                        (r) => r.fromPlaceId === current.id && r.toPlaceId === place.id,
                      );
                    const isCurrent = current?.id === place.id;
                    return (
                      <button
                        type="button"
                        className={s.searchResultItem}
                        key={place.id}
                        onClick={() => {
                          searchInputRef.current?.blur();
                          setSearchActive(false);
                          selectPlace(place.id);
                        }}
                      >
                        <div className={s.searchResultIcon} aria-hidden="true">
                          {isCurrent ? '📍' : '⌖'}
                        </div>
                        <div className={s.searchResultBody}>
                          <div className={s.searchResultNameRow}>
                            <span className={s.searchResultName}>{place.name}</span>
                            {isCurrent && <span className={s.currentTag}>当前位置</span>}
                          </div>
                          {place.description && (
                            <p className={s.searchResultDesc}>{place.description}</p>
                          )}
                        </div>
                        <small className={s.searchResultRoute}>
                          {isCurrent
                            ? '就在这里'
                            : knownRoute
                              ? `${knownRoute.durationMinutes} 分钟`
                              : '路线未建立'}
                        </small>
                        <span className={s.chevron} aria-hidden="true">
                          ›
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          ) : (
            <>
          <section className={s.location} aria-label="当前位置">
            <span className={s.currentDot} aria-hidden="true" />
            <div>
              <p className={s.eyebrow}>你现在在</p>
              <h2>{waitingPosition ? '正在更新当前位置' : current?.name || '位置尚未确认'}</h2>
            </div>
          </section>
          {diagram && (
            <section className={s.diagram} aria-label="地点示意">
              <span className={s.diagramLabel}>地点示意 · 非地理距离</span>
              <div
                className={`${s.graph} ${mapTheme === 'transit' ? s.graphTransit : ''}`}
                style={{
                  height: Math.max(220, diagram.height),
                  transform:
                    zoomScale !== 1 || panOffset.x !== 0 || panOffset.y !== 0
                      ? `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`
                      : undefined,
                  transformOrigin: 'center center',
                  transition: isGesturing ? 'none' : 'transform 0.25s ease',
                }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
              >
                {/* Decorative Elements */}
                <div
                  className={s.compassBadge}
                  aria-hidden="true"
                  onClick={() => {
                    setZoomScale(1);
                    setPanOffset({ x: 0, y: 0 });
                  }}
                >
                  <span>N ↑</span>
                </div>
                <div className={s.floatingTools} aria-label="地图辅助控制">
                  <button
                    type="button"
                    className={`${s.toolBtn} ${mapTheme !== 'standard' ? s.toolBtnActive : ''}`}
                    onClick={() => setMapTheme((t) => (t === 'standard' ? 'transit' : 'standard'))}
                    aria-label="切换图层"
                  >
                    <span className={s.toolIcon} aria-hidden="true">
                      ⊞
                    </span>
                    <span className={s.toolLabel}>图层</span>
                  </button>
                  <div className={s.zoomGroup}>
                    <button
                      type="button"
                      className={s.zoomBtn}
                      onClick={() =>
                        setZoomScale((z) => Math.min(1.5, Number((z + 0.15).toFixed(2))))
                      }
                      aria-label="放大地图"
                    >
                      +
                    </button>
                    <div className={s.zoomDivider} />
                    <button
                      type="button"
                      className={s.zoomBtn}
                      onClick={() =>
                        setZoomScale((z) => {
                          const next = Math.max(0.8, Number((z - 0.15).toFixed(2)));
                          if (next <= 1) setPanOffset({ x: 0, y: 0 });
                          return next;
                        })
                      }
                      aria-label="缩小地图"
                    >
                      −
                    </button>
                  </div>
                  <button
                    type="button"
                    className={s.locateBtn}
                    onClick={() => {
                      setZoomScale(1);
                      setPanOffset({ x: 0, y: 0 });
                      if (current) selectPlace(current.id);
                    }}
                    aria-label="回到当前地点"
                  >
                    ◎
                  </button>
                </div>
                {/* Decorative Street Blocks */}
                <div
                  className={s.gridBlock}
                  style={{ left: 16, top: 58, width: 68, height: 42 }}
                  aria-hidden="true"
                />
                <div
                  className={s.gridBlock}
                  style={{ left: 104, top: 58, width: 88, height: 42 }}
                  aria-hidden="true"
                />
                <div
                  className={s.greenBlock}
                  style={{ right: 16, top: 62, width: 72, height: 50 }}
                  aria-hidden="true"
                />
                <div
                  className={s.gridBlock}
                  style={{ left: 24, bottom: 24, width: 84, height: 44 }}
                  aria-hidden="true"
                />
                <div
                  className={s.gridBlock}
                  style={{ right: 36, bottom: 20, width: 96, height: 48 }}
                  aria-hidden="true"
                />
                <span className={s.streetNameOne} aria-hidden="true">
                  丰和路
                </span>
                <span className={s.streetNameTwo} aria-hidden="true">
                  长宁路
                </span>
                <span className={s.streetNameThree} aria-hidden="true">
                  长宁巷
                </span>
                <div className={s.mapWatermark} aria-hidden="true">
                  <span>◇路线示意</span>
                </div>
                <div className={s.scaleBar} aria-hidden="true">
                  <span>200米</span>
                  <div className={s.scaleLine} />
                </div>
                <svg
                  className={s.lines}
                  viewBox={`0 0 320 ${Math.max(220, diagram.height)}`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                  focusable="false"
                >
                  <defs>
                    <marker
                      id={routeArrow}
                      markerWidth="4"
                      markerHeight="4"
                      refX="3"
                      refY="2"
                      orient="auto"
                    >
                      <path d="M0 0 L4 2 L0 4" fill="#237af0" />
                    </marker>
                  </defs>
                  {diagram.edges.map(({ route, from, to }) => {
                    const isSelectedRoute =
                      route.id === mapSelection(space!, selected?.id).route?.id;
                    const isTraveling =
                      operation?.status === 'committed' && operation.receipt?.routeId === route.id;
                    return (
                      <g key={route.id}>
                        <path
                          data-known-route={route.id}
                          className={
                            isSelectedRoute
                              ? `${s.selectedLine} ${busyAction === 'travel' ? s.animatedRoute : ''}`
                              : s.line
                          }
                          d={`M${from.x} ${from.y} L${to.x} ${to.y}`}
                          markerEnd={`url(#${routeArrow})`}
                        />
                        {isSelectedRoute && isTraveling && (
                          <g className={s.movingVehicle}>
                            <circle r="4" fill="#2563eb">
                              <animateMotion
                                path={`M${from.x} ${from.y} L${to.x} ${to.y}`}
                                dur="2.2s"
                                repeatCount="indefinite"
                              />
                            </circle>
                            <text textAnchor="middle" dy="-6" fontSize="12">
                              <animateMotion
                                path={`M${from.x} ${from.y} L${to.x} ${to.y}`}
                                dur="2.2s"
                                repeatCount="indefinite"
                              />
                              {route.modeLabel.includes('步行')
                                ? '🚶'
                                : route.modeLabel.includes('车')
                                  ? '🚗'
                                  : '•'}
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}
                </svg>
                {diagram.points.map(({ place, x, y }) => {
                  const isMatchQuery =
                    !searchQuery.trim() ||
                    place.name.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
                    Boolean(
                      place.description &&
                      place.description.toLowerCase().includes(searchQuery.trim().toLowerCase()),
                    );
                  const isMatchCat =
                    !activeCategory ||
                    (activeCategory === 'food' &&
                      /餐|吃|饭|店|馆|食|酒|茶|咖/.test(place.name + (place.description || ''))) ||
                    (activeCategory === 'pharmacy' &&
                      /药|医|院|急救|诊所|康/.test(place.name + (place.description || ''))) ||
                    (activeCategory === 'park' &&
                      /园|湖|林|绿|树|山|草/.test(place.name + (place.description || ''))) ||
                    (activeCategory === 'wc' &&
                      /公厕|卫|洗手|厕/.test(place.name + (place.description || '')));
                  const isDimmed = !isMatchQuery || !isMatchCat;

                  return (
                    <button
                      type="button"
                      key={place.id}
                      className={place.id === selected?.id ? s.selectedPoint : s.point}
                      style={{
                        left: `${(x / 320) * 100}%`,
                        top: y,
                        opacity: isDimmed ? 0.35 : 1,
                        transition:
                          'opacity 0.2s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
                      }}
                      aria-pressed={place.id === selected?.id}
                      onClick={() => selectPlace(place.id)}
                    >
                      <span
                        className={
                          place.id === current?.id && !waitingPosition ? s.currentPin : s.pin
                        }
                        aria-hidden="true"
                      >
                        ●
                      </span>
                      <span className={s.pointLabel}>{place.name}</span>
                      {place.id === current?.id && !waitingPosition && <small>当前位置</small>}
                    </button>
                  );
                })}
              </div>
              {diagram.partial && <p className={s.diagramLabel}>其余地点见下方列表</p>}
            </section>
          )}
          <section className={s.destinations} aria-label="选择目的地">
            <div className={s.sheetHandle} aria-hidden="true" />
            <div className={s.exploreHeader}>
              <div className={s.exploreTitleGroup}>
                <h2 className={s.sectionTitle}>探索附近</h2>
                <small>{space.places.length} 个已知地点</small>
              </div>
            </div>
            <div className={s.categoryGrid} role="group" aria-label="地点快捷分类">
              <button
                type="button"
                className={`${s.catBtn} ${activeCategory === 'food' ? s.catBtnActive : ''}`}
                onClick={() => setActiveCategory((c) => (c === 'food' ? null : 'food'))}
              >
                <span className={`${s.catBadge} ${s.catFood}`}>餐</span>
                <span className={s.catText}>美食</span>
              </button>
              <button
                type="button"
                className={`${s.catBtn} ${activeCategory === 'pharmacy' ? s.catBtnActive : ''}`}
                onClick={() => setActiveCategory((c) => (c === 'pharmacy' ? null : 'pharmacy'))}
              >
                <span className={`${s.catBadge} ${s.catMed}`}>+</span>
                <span className={s.catText}>药店</span>
              </button>
              <button
                type="button"
                className={`${s.catBtn} ${activeCategory === 'park' ? s.catBtnActive : ''}`}
                onClick={() => setActiveCategory((c) => (c === 'park' ? null : 'park'))}
              >
                <span className={`${s.catBadge} ${s.catPark}`}>叶</span>
                <span className={s.catText}>公园</span>
              </button>
              <button
                type="button"
                className={`${s.catBtn} ${activeCategory === 'wc' ? s.catBtnActive : ''}`}
                onClick={() => setActiveCategory((c) => (c === 'wc' ? null : 'wc'))}
              >
                <span className={`${s.catBadge} ${s.catWc}`}>WC</span>
                <span className={s.catText}>公厕</span>
              </button>
            </div>
            <div className={s.quickActions}>
              <button
                type="button"
                className={s.quickPill}
                onClick={() => {
                  if (current) selectPlace(current.id);
                }}
              >
                <span className={s.quickIcon} aria-hidden="true">
                  ◎
                </span>{' '}
                我的位置
              </button>
              <button
                type="button"
                className={`${s.quickPill} ${!activeCategory && !searchQuery ? s.quickPillActive : ''}`}
                onClick={() => {
                  setActiveCategory(null);
                  setSearchQuery('');
                  setSearchActive(false);
                  searchInputRef.current?.blur();
                }}
              >
                <span className={s.quickIcon} aria-hidden="true">
                  🗺️
                </span>{' '}
                全部地点
              </button>
            </div>
            {space.places
              .filter((place) => place.id !== current?.id)
              .filter((place) => {
                if (searchQuery.trim()) {
                  const q = searchQuery.trim().toLowerCase();
                  return (
                    place.name.toLowerCase().includes(q) ||
                    Boolean(place.description && place.description.toLowerCase().includes(q))
                  );
                }
                if (activeCategory === 'food') {
                  return /餐|吃|饭|店|馆|食|酒|茶|咖/.test(place.name + (place.description || ''));
                }
                if (activeCategory === 'pharmacy') {
                  return /药|医|院|急救|诊所|康/.test(place.name + (place.description || ''));
                }
                if (activeCategory === 'park') {
                  return /园|湖|林|绿|树|山|草/.test(place.name + (place.description || ''));
                }
                if (activeCategory === 'wc') {
                  return /公厕|卫|洗手|厕/.test(place.name + (place.description || ''));
                }
                return true;
              })
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
                <>
                  <div className={s.routeSummary}>
                    <strong>{route.durationMinutes} 分钟</strong>
                    <span>
                      {route.modeLabel || '移动'} · 约{' '}
                      {arrival.slice(0, 10) === worldDateTimeLabel(space.storyNow).slice(0, 10)
                        ? arrival.slice(11, 16)
                        : arrival}{' '}
                      到达
                    </span>
                  </div>
                </>
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
                <>
                  <div className={s.currentPlaceSceneBadge} role="status">
                    <span className={s.currentPlaceSceneBadgeIcon} aria-hidden="true">
                      📍
                    </span>
                    <div className={s.currentPlaceSceneBadgeContent}>
                      <strong>已身处当前地点</strong>
                      <span>
                        进入现场可查看当前场景、环境旁白，并与在场人物当面对话互动。
                      </span>
                    </div>
                  </div>
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
                    {busyAction === 'enter'
                      ? '正在打开…'
                      : space.currentSceneId
                        ? '看看这里（回到现场）'
                        : '看看这里（进入现场）'}
                  </button>
                </>
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
        </>
      )}
    </div>
  );
}
