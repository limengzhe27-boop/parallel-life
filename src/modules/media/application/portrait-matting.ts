/** Server-side image preparation. It does not create world facts, messages or paid calls. */
export interface PortraitMatting {
  removePortraitBackground(bytes: Buffer, signal?: AbortSignal): Promise<Buffer>;
}
