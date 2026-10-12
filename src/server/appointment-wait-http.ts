import { authenticated, endpoint, HttpError, json, parseBody } from './http.ts';
import { requestLimit } from './limits.ts';
import { Id } from '../contracts/api.ts';
import {
  AppointmentWaitRequestSchema,
  AppointmentWaitReceiptSchema,
  type AppointmentWaitRequest,
} from '../contracts/appointment-wait.ts';
import {
  AppointmentWaitError,
  appointmentWaitMessages,
  type AppointmentWaitReceipt,
} from '../modules/world/domain/appointment-wait.ts';
type WaitService = {
  waitToAppointment: (
    ownerId: string,
    worldId: string,
    input: AppointmentWaitRequest,
  ) => Promise<AppointmentWaitReceipt>;
};
/** Root assembles the real repository. No unconfigured route may report a completed wait. */
export function appointmentWaitRoute(request: Request, worldId: string) {
  return endpoint(async () => {
    const id = Id.safeParse(worldId);
    if (!id.success) throw new HttpError('NOT_FOUND', 404);
    const services = await authenticated(request);
    await requestLimit(services.db, services.ownerId);
    const input = await parseBody(request, AppointmentWaitRequestSchema);
    const wait = (services as typeof services & Partial<WaitService>).waitToAppointment;
    if (typeof wait !== 'function') throw new HttpError('UNAVAILABLE', 503);
    try {
      const receipt = AppointmentWaitReceiptSchema.parse(
        await wait(services.ownerId, id.data, input),
      );
      if (
        receipt.worldId !== id.data ||
        receipt.commandId !== input.commandId ||
        receipt.invitationId !== input.invitationId ||
        receipt.version !== input.expectedVersion + 1
      )
        throw new HttpError('UNAVAILABLE', 503);
      return json(receipt);
    } catch (error) {
      if (error instanceof AppointmentWaitError)
        return json(
          {
            error: {
              code: 'INVALID_COMMAND',
              message: appointmentWaitMessages[error.reason],
              retryable: false,
            },
          },
          422,
        );
      throw error;
    }
  });
}
