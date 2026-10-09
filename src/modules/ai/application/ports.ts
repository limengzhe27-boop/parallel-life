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
export type ModelOutputOptions = { format: 'json_object' };
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
