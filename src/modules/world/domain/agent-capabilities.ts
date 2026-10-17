/** Product-supported capabilities. Personal willingness and current execution eligibility are separate. */
export const NPC_AGENT_CAPABILITIES = [
  'plan.record',
  'appointment.propose',
  'travel.begin',
  'appointment.fulfill',
  'appointment.cancel',
  'appointment.accept',
  'appointment.reschedule',
  'media.generate_image',
  'media.generate_video',
  'media.share',
] as const;
