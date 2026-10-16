/** Supplied to one paid model request, not proof the model understood it or a world outcome. */
export type NpcSuppliedContext = {
  schemaVersion: 1;
  promptVersion: string;
  modelInputHash: string;
  observations: { sourceId: string; contentHash: string }[];
};
