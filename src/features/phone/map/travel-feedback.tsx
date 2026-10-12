'use client';

import { travelPresentation, type TravelFeedbackState } from './travel-presentation.ts';
import s from './travel-feedback.module.css';

export type TravelFeedbackProps = {
  state: TravelFeedbackState;
  checking?: boolean;
  onCheckResult?: () => void;
  onRetry?: () => void;
  /** Only after read-only recovery found no receipt; resubmits the identical atomic command. */
  onResubmitOriginal?: () => void;
  onContinue?: () => void;
  continueLabel?: string;
};

/** Presentational only: animation never updates location or advances the story clock. */
export function TravelFeedback({
  state,
  checking = false,
  onCheckResult,
  onRetry,
  onResubmitOriginal,
  onContinue,
  continueLabel = '看看这里',
}: TravelFeedbackProps) {
  const view = travelPresentation(state);
  if (!view) return null;
  const pending = view.status === 'pending';
  const committed = view.status === 'committed';
  const handler =
    view.action === 'check' ? onCheckResult : view.action === 'retry' ? onRetry : onContinue;
  const label =
    view.action === 'check'
      ? checking
        ? '正在查看…'
        : '查看行程结果'
      : view.action === 'retry'
        ? '再试一次'
        : continueLabel;

  return (
    <section
      className={s.feedback}
      data-travel-status={view.status}
      aria-label="行程状态"
      aria-busy={pending || checking}
    >
      {committed ? (
        <div className={s.route} aria-hidden="true">
          <svg viewBox="0 0 280 52" focusable="false">
            <circle className={s.origin} cx="14" cy="26" r="6" />
            <path className={s.track} d="M28 26 H252" />
            <path className={s.routeLine} d="M28 26 H252" />
            <circle className={s.destination} cx="266" cy="26" r="9" />
            <path className={s.check} d="m262 26 3 3 5-6" />
          </svg>
          <div className={s.routeLabels}>
            <span>{view.fromLabel || '出发地'}</span>
            <span>{view.destinationLabel}</span>
          </div>
        </div>
      ) : (
        <span className={pending || checking ? s.spinner : s.notice} aria-hidden="true">
          {pending || checking ? '' : '!'}
        </span>
      )}
      <div role={view.status === 'failed' ? 'alert' : 'status'} aria-atomic="true">
        <h2>{view.title}</h2>
        {view.arrivedAtLabel && <p className={s.arrivalTime}>{view.arrivedAtLabel}</p>}
        <p className={s.description}>{view.description}</p>
      </div>
      {handler && view.action && (
        <button type="button" disabled={checking} onClick={handler} className={s.action}>
          {label}
        </button>
      )}
      {view.status === 'unknown' && onResubmitOriginal && (
        <button
          type="button"
          disabled={checking}
          onClick={onResubmitOriginal}
          className={`${s.action} ${s.secondary}`}
        >
          重新提交这次行程
        </button>
      )}
    </section>
  );
}
