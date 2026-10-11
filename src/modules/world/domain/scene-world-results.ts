import { resolveSceneStepProgress } from './scene-step-progress.ts';
import type { SceneStepProposal, SceneNpcActionProposal } from './matters.ts';
import { progressSceneMatters } from './matter-progression.ts';
import { DomainError } from './errors.ts';
import type { WorldState, Fact, Appointment } from './types.ts';
import type { SceneSession, SceneAction } from './experience-rules.ts';
import { scenePresent } from './scene-runtime.ts';
import {
  validateWorldMatterSceneUpdate,
  sceneMatterId,
  sceneMatterResultFact,
  sceneAttendance,
} from './scene-matter-policy.ts';
export type SceneWorldResults = {
  scene: SceneSession;
  action?: SceneAction;
  updates: {
    matterId: string;
    expectedMatterVersion: number;
    status: 'in_progress' | 'blocked' | 'completed';
  }[];
  attendance?: { appointmentId: string };
  observerFacts: Fact[];
  execution?: {stepProposals:SceneStepProposal[];npcActions:SceneNpcActionProposal[];dialogues:{actorId:string;text:string}[]};
};
export type SceneResultEvent = {
  id: string;
  worldId: string;
  version: number;
  storyAt: string;
  type: string;
  data: { worldResults?: SceneWorldResults };
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
/** Only a runtime-built scene result delta is eligible; AI proposals never own this object. */
export function applySceneWorldResults(
  current: WorldState,
  event: SceneResultEvent,
  initial: WorldState = current,
): WorldState {
  const results = event.data.worldResults;
  if (!results) return { ...current, version: event.version, time: event.storyAt };
  const { scene, action } = results;
  if (
    !['scene.opened', 'scene.action_resolved'].includes(event.type) ||
    event.worldId !== current.id ||
    event.version !== current.version + 1 ||
    scene.worldId !== current.id ||
    scene.ownerId !== current.ownerId ||
    scene.status !== 'active' ||
    Date.parse(event.storyAt) < Date.parse(current.time) ||
    !Number.isFinite(Date.parse(event.storyAt)) ||
    (event.type === 'scene.action_resolved') !== Boolean(action)
  )
    throw new DomainError('INVALID_PROPOSAL', 'Invalid scene-world result source');
  const present = scenePresent(scene, event.version),
    witnesses = present.flatMap((p) => (p.kind === 'actor' ? [p.actorId] : []));
  if (
    !present.some((p) => p.kind === 'player') ||
    witnesses.some((id) => !current.actors.some((a) => a.id === id)) ||
    new Set(results.updates.map((u) => u.matterId)).size !== results.updates.length
  )
    throw new DomainError('INVALID_PROPOSAL', 'Invalid physical observers or duplicated target');
  if (
    action &&
    (action.ownerId !== current.ownerId ||
      action.sourceVersion >= event.version ||
      action.status !== 'resolved' ||
      action.resolution?.sourceEventId !== event.id ||
      action.resolution.sourceVersion !== event.version)
  )
    throw new DomainError('INVALID_PROPOSAL', 'Action resolution does not belong to this source');
  let next = { ...current, matters: [...(current.matters ?? [])] };
  if(results.execution){
    if(!action)throw new DomainError('INVALID_PROPOSAL','Execution requires saved action');
    const progress=resolveSceneStepProgress({world:current,initial,scene,action,...results.execution,event:{id:event.id,version:event.version,at:event.storyAt}});
    next.matters=progress.matters;
    if(progress.completedMatterIds.some(id=>!results.updates.some(u=>u.matterId===id&&u.status==='completed')))
      throw new DomainError('INVALID_PROPOSAL','Verified endpoint not carried into matter result');
  }
  const facts: Fact[] = [];
  for (const update of results.updates) {
    const target = next.matters.find((m) => m.id === update.matterId);
    if (
      !action ||
      !target ||
      current.matters?.find(m=>m.id===update.matterId)?.version !== update.expectedMatterVersion ||
      !action.relatedMatterIds.includes(sceneMatterId(scene.id, target.id))
    )
      throw new DomainError('INVALID_PROPOSAL', 'Invalid matter action binding');
    const result = validateWorldMatterSceneUpdate({
      world: next,
      initial,
      scene,
      action,
      status: update.status,
      matterId: target.id,
      eventId: event.id,
      eventVersion: event.version,
      at: event.storyAt,
    });
    next.matters = next.matters.map((m) => (m.id === result.id ? result : m));
    const fact = sceneMatterResultFact(result, witnesses);
    if (fact) facts.push(fact);
  }
  const progression = progressSceneMatters(
    current,
    initial,
    next.matters,
    { id: event.id, version: event.version, at: event.storyAt },
    witnesses,
  );
  next.matters = progression.matters;
  facts.push(...progression.observerFacts);
  if (canonical(facts) !== canonical(results.observerFacts))
    throw new DomainError('INVALID_PROPOSAL', 'Forged observer facts');
  let attendance: Appointment | undefined;
  if (results.attendance) {
    attendance = sceneAttendance(current, scene, witnesses, event.storyAt, event.version);
    if (!attendance || attendance.id !== results.attendance.appointmentId)
      throw new DomainError('INVALID_PROPOSAL', 'Unwitnessed or mismatched attendance');
  }
  return {
    ...next,
    version: event.version,
    time: event.storyAt,
    facts: [...current.facts, ...facts],
    appointments: attendance
      ? current.appointments.map((a) => (a.id === attendance!.id ? attendance! : a))
      : current.appointments,
  };
}
