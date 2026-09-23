export type ModelMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export interface TextModel {
  /** `maxTokens` overrides the default output cap; long structured calls need far more than a chat reply. */
  complete(messages: ModelMessage[], signal?: AbortSignal, maxTokens?: number): Promise<string>;
  streamComplete?(messages: ModelMessage[], signal?: AbortSignal): AsyncIterable<string>;
}
