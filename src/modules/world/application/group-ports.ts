import type { WorldState } from '../domain/types.ts';
import type {
  ExperienceContext,
  GroupConversation,
  GroupMessage,
  Participant,
} from '../domain/experience-rules.ts';
import type { GroupReply } from '../domain/group-runtime.ts';
export type GroupRead = {
  world: WorldState;
  context: ExperienceContext;
  group: GroupConversation;
  messages: GroupMessage[];
  messageTimes?: Record<string, { storyAt: string; occurredAt: string }>;
};
export type GroupActorInput = {
  actor: WorldState['actors'][number];
  worldTitle: string;
  storyAt: string;
  publicFacts: WorldState['facts'];
  groupTitle: string;
  members: { participant: Participant; name: string }[];
  messages: GroupMessage[];
};
export interface GroupPlanner {
  propose(input: GroupActorInput, signal?: AbortSignal): Promise<Omit<GroupReply, 'actorId'>>;
}
/** Owner and exact world are runtime scope; never copied from a model. */
export type GroupTaskInput = {
  channel: 'group';
  worldId: string;
  groupId: string;
  expectedVersion: number;
  inputEventId: string;
  text: string;
};
