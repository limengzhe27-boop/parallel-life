export type TravelArrival = {
  fromLabel?: string;
  destinationLabel: string;
  durationMinutes: number;
  arrivedAtLabel: string;
};

/** Only the controller that verified the original command receipt may supply committed. */
export type TravelFeedbackState =
  | { status: 'idle' }
  | { status: 'pending'; destinationLabel: string }
  | { status: 'unknown'; destinationLabel: string; message?: string }
  | { status: 'failed'; destinationLabel: string; message?: string }
  | { status: 'committed'; arrival: TravelArrival };

export type TravelPresentation = {
  status: Exclude<TravelFeedbackState['status'], 'idle'>;
  title: string;
  description: string;
  fromLabel?: string;
  destinationLabel?: string;
  arrivedAtLabel?: string;
  action: 'check' | 'retry' | 'continue' | null;
};

export function travelPresentation(state: TravelFeedbackState): TravelPresentation | null {
  switch (state.status) {
    case 'idle':
      return null;
    case 'pending':
      return {
        status: state.status,
        title: '正在确认行程…',
        description: `前往${state.destinationLabel}的请求已提交。`,
        action: null,
      };
    case 'unknown':
      return {
        status: state.status,
        title: '行程结果还在确认',
        description: state.message || '先查看这次行程的结果，避免重复出发。',
        action: 'check',
      };
    case 'failed':
      return {
        status: state.status,
        title: '这次没能前往',
        description: state.message || '行程没有完成，可以稍后再试。',
        action: 'retry',
      };
    case 'committed': {
      const arrival = state.arrival;
      if (
        !arrival.destinationLabel.trim() ||
        !Number.isSafeInteger(arrival.durationMinutes) ||
        arrival.durationMinutes < 0 ||
        !arrival.arrivedAtLabel.trim()
      ) {
        return {
          status: 'unknown',
          title: '到达详情还在确认',
          description: '请查看这次行程的结果。',
          action: 'check',
        };
      }
      return {
        status: state.status,
        title: `已到达${arrival.destinationLabel}`,
        description:
          arrival.durationMinutes === 0
            ? '位置已更新。'
            : `过去了 ${arrival.durationMinutes} 分钟。`,
        fromLabel: arrival.fromLabel,
        destinationLabel: arrival.destinationLabel,
        arrivedAtLabel: arrival.arrivedAtLabel,
        action: 'continue',
      };
    }
  }
}
