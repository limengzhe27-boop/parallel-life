import { DomainError } from '../domain/errors.ts';
import { parseProposal, validateCommand, validateEventId } from '../domain/validation.ts';
import { validateCharacterEffects } from '../domain/character-policy.ts';
import type { Session, TurnCommand, CommitResult } from '../domain/types.ts';
import type { MemoryRecord } from '../../memory/domain/types.ts';
import type { WorldRepository, TurnPlanner } from './ports.ts';
import { actorContext } from './actor-context.ts';
import { routeUserIntent } from './intent-router.ts';

/** Internal trusted orchestration entry point, not an HTTP request handler. */
export async function resolveTurn(
  deps: {
    worlds: WorldRepository;
    planner: TurnPlanner;
    now: () => string;
    /** Read-only projection of the world's clock at the supplied real instant. */
    storyNow?: (realNow: string) => string;
    newId: () => string;
    /** Optional: what this character may recall. Absent means no memory is attached. */
    memories?: (
      actorId: string,
    ) => Promise<{ records: MemoryRecord[]; blockedSources: Set<string> }>;
  },
  session: Session,
  command: TurnCommand,
): Promise<CommitResult> {
  validateCommand(command);
  const receipt = await deps.worlds.receipt(session, command);
  if (receipt) return receipt;
  const world = await deps.worlds.get(session, command.worldId);
  if (world.version !== command.expectedVersion) throw new DomainError('VERSION_CONFLICT');
  const requestAt = deps.now();
  const userAt =
    command.origin === 'director'
      ? world.time
      : new Date(
          Math.max(Date.parse(world.time), Date.parse(deps.storyNow?.(requestAt) ?? world.time)),
        ).toISOString();
  const recalled = deps.memories
    ? await deps.memories(command.actorId)
    : { records: [] as MemoryRecord[], blockedSources: new Set<string>() };
  const context = actorContext(
    { ...world, time: userAt },
    command.actorId,
    command.text,
    recalled.records,
    recalled.blockedSources,
  );
  if (command.origin) context.turnOrigin = command.origin;
  const proposal = parseProposal(await deps.planner.propose({ context, userText: command.text }));
  /*
   * 意图接线：角色回复之外，用户明确索图时必须产生一条 media.requested，
   * 否则 outbox 永远没有可执行的任务，"发张照片"会静默什么都不发生。
   */
  const intent = routeUserIntent({ text: command.text });
  if (
    command.origin !== 'director' &&
    intent.turnMode === 'image' &&
    !proposal.effects.some((e) => e.type === 'media.requested')
  )
    proposal.effects.push({
      type: 'media.requested',
      id: `${command.id}_media`,
      prompt: (intent.imagePrompt ?? command.text).slice(0, 2000),
    });
  validateCharacterEffects(command.actorId, proposal.effects);
  const eventId = validateEventId(deps.newId());
  // Model IDs are local labels, never trusted as globally unique storage IDs.
  const effects = proposal.effects.map((effect, index) => ({
    ...effect,
    id: `${eventId}_effect_${index}`,
  }));
  const occurredAt = deps.now();
  const replyAt =
    command.origin === 'director'
      ? undefined
      : new Date(
          Math.max(Date.parse(userAt), Date.parse(deps.storyNow?.(occurredAt) ?? world.time)),
        ).toISOString();
  return deps.worlds.commit(session, command, {
    schemaVersion: 1,
    id: eventId,
    worldId: world.id,
    version: world.version + 1,
    commandId: command.id,
    occurredAt,
    ...(replyAt ? { storyAt: replyAt } : {}),
    type: 'turn.resolved',
    data: {
      actorId: command.actorId,
      userText: command.text,
      effects,
      ...(replyAt ? { userAt } : {}),
      ...(command.origin ? { origin: command.origin } : {}),
    },
  });
}
