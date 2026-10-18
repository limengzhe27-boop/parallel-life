/** Only server-authorized, bounded image bytes; remote URLs and credentials are not accepted. */
export type ModelImage = {
  mimeType: 'image/webp' | 'image/png' | 'image/jpeg';
  base64: string;
  detail: 'low';
};
export type ModelMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: ModelImage[];
};
export type ModelOutputOptions =
  | { format: 'json_object' }
  | { format: 'json_schema'; name: string; schema: Record<string, unknown>; strict: boolean };
export interface TextModel {
  /** `maxTokens` overrides the default output cap; long structured calls need far more than a chat reply. */
  complete(
    messages: ModelMessage[],
    signal?: AbortSignal,
    maxTokens?: number,
    output?: ModelOutputOptions,
  ): Promise<string>;
  streamComplete?(
    messages: ModelMessage[],
    signal?: AbortSignal,
    output?: ModelOutputOptions,
  ): AsyncIterable<string>;
}

/** Evidence of an explicit provider request rejection, distinct from a lost result. */
export function modelRequestRejection(error: unknown): { httpStatus: number } | null {
  if (
    !error ||
    typeof error !== 'object' ||
    !('responseOutcome' in error) ||
    error.responseOutcome !== 'rejected' ||
    !('httpStatus' in error) ||
    typeof error.httpStatus !== 'number' ||
    ![400, 401, 403, 404, 413, 415, 422].includes(error.httpStatus)
  )
    return null;
  return { httpStatus: error.httpStatus };
}
