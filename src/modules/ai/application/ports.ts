export type ModelMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export interface TextModel {
  complete(messages: ModelMessage[], signal?: AbortSignal): Promise<string>;
}
