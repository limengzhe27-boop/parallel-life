import assert from 'node:assert/strict';

/** Current provider envelope only; never rewrites historical response fixtures. */
export function npcChangeObject(schema: any): any {
  const changes = schema.properties.changes;
  const object =
    changes.type === 'object' ? changes : changes.anyOf.find((node: any) => node.type === 'object');
  assert(object, 'current schema must expose a structured changes delta');
  assert.equal(object.additionalProperties, false);
  return object;
}
