/** Explicit synthetic test output, never a production fallback or evidence of AI generation. */
export function historyFixture<T>(
  opening: T,
  authoredKeys: string[] = ['c_0', 'c_1'],
): T & {
  messageHistory: {
    version: 1;
    messages: { key: string; actorKey: string; text: string; minutesBeforeStart: number }[];
  };
} {
  const source = opening as T & { actors?: { key: string }[]; messageHistory?: unknown };
  const keys = source.actors?.map((actor) => actor.key) ?? authoredKeys;
  return {
    ...opening,
    messageHistory: {
      version: 1,
      messages: keys.map((actorKey, index) => ({
        key: `fixture_past_${index}`,
        actorKey,
        text: `显式历史测试夹具${index}，仅验证同一人物旧来信。`,
        minutesBeforeStart: 2880 + index * 60,
      })),
    },
  };
}
