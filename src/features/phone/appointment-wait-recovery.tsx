'use client';
/** Receipt recovery is independent of whether a fresh wait is still eligible. */
export function AppointmentWaitRecovery({
  pending,
  working,
  message,
  onRecover,
}: {
  pending: boolean;
  working: boolean;
  message: string;
  onRecover: () => void;
}) {
  if (!pending && !message) return null;
  return (
    <div
      role="status"
      style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '6px 8px' }}
    >
      <span>{pending ? '上次等待的结果还需要核对。' : message}</span>
      {pending ? (
        <button
          disabled={working}
          onClick={() => {
            if (!working) onRecover();
          }}
        >
          {working ? '正在核对…' : '核对原等待'}
        </button>
      ) : null}
    </div>
  );
}
