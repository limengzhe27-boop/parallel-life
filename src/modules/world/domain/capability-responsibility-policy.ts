/** These kernel capabilities may certify handled external responsibilities with real results. */
const handlingCapabilities = new Set([
  'appointment.fulfill',
  'appointment.cancel',
  'appointment.accept',
  'appointment.reschedule',
  'item.deliver',
  'item.use',
  'activity.participate',
  'relationship.bond',
  'moment.publish',
  'moment.interact',
]);

/** Proposals, media enqueue, travel and unknown capabilities do not certify responsibility resolution. */
export function canHandleExternalResponsibility(capability: string): boolean {
  return handlingCapabilities.has(capability);
}
