import type { AppointmentWaitInput, AppointmentWaitReceipt } from '../domain/appointment-wait.ts';
export interface AppointmentWaitPort {
  wait(
    ownerId: string,
    worldId: string,
    input: AppointmentWaitInput,
  ): Promise<AppointmentWaitReceipt>;
}
/** Explicitly waiting for one confirmed appointment does not run a director, model or scene task. */
export function waitToAppointment(
  waits: AppointmentWaitPort,
  ownerId: string,
  worldId: string,
  input: AppointmentWaitInput,
): Promise<AppointmentWaitReceipt> {
  return waits.wait(ownerId, worldId, input);
}
