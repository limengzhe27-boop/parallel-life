import type { MediaRequest, Message } from './types.ts';

type ChatMediaFields = {
  photoId?: string;
  mediaStatus?: 'pending' | 'ready' | 'failed';
  mediaTitle?: string;
  mediaType?: 'image' | 'video';
};

/** One durable request produces one image bubble, never one image per statement.
 * Pending work stays attached to the final text for polling, not as a new message.
 * Original message identities/text and historical read state remain unchanged.
 */
export function projectChatMediaMessages<
  T extends Pick<Message, 'id' | 'actorId' | 'role' | 'text' | 'at'>,
>(
  messages: readonly Message[],
  requests: readonly MediaRequest[],
  project: (message: Message) => T,
): Array<T & ChatMediaFields> {
  const lastByEventActor = new Map<string, string>();
  const lastByEvent = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    lastByEventActor.set(JSON.stringify([message.sourceEventId, message.actorId]), message.id);
    lastByEvent.set(message.sourceEventId, message.id);
  }
  const byMessage = new Map<string, MediaRequest[]>();
  for (const request of requests) {
    const delivery = request.deliveryDecision as
      (MediaRequest['deliveryDecision'] & { approved?: boolean }) | undefined;
    if (request.isPlayer || (delivery?.deliverToChat ?? delivery?.approved) === false) continue;
    const boundReply =
      request.replyMessageId &&
      messages.find(
        (message) =>
          message.id === request.replyMessageId &&
          message.role === 'assistant' &&
          message.actorId === request.targetActorId,
      );
    const messageId = boundReply
      ? boundReply.id
      : request.targetActorId
        ? lastByEventActor.get(JSON.stringify([request.sourceEventId, request.targetActorId]))
        : lastByEvent.get(request.sourceEventId);
    if (!messageId) continue;
    byMessage.set(messageId, [...(byMessage.get(messageId) ?? []), request]);
  }
  return messages.flatMap((message): Array<T & ChatMediaFields> => {
    const base = project(message);
    const related = byMessage.get(message.id) ?? [];
    const pending = related.find(
      (request) => request.status === 'pending' || request.status === 'unknown',
    );
    const failed = related.find((request) => request.status === 'failed');
    const status = pending ? 'pending' : failed ? 'failed' : undefined;
    return [
      {
        ...base,
        ...(status
          ? {
              mediaStatus: status,
              mediaType: (pending ?? failed)?.mediaType ?? 'image',
              ...((pending ?? failed)?.title ? { mediaTitle: (pending ?? failed)!.title } : {}),
            }
          : {}),
      },
      ...related
        .filter((request) => request.status === 'ready' && request.assetId)
        .map((request) => ({
          ...base,
          id: `media_${request.id}`,
          text: '',
          photoId: request.assetId!,
          mediaStatus: 'ready' as const,
          mediaType: request.mediaType ?? 'image',
          ...(request.title ? { mediaTitle: request.title } : {}),
        })),
    ];
  });
}
