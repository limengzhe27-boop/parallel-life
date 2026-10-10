import { validateCommand } from '../domain/validation.ts';
import type { Session, TurnCommand, CommitResult } from '../domain/types.ts';
import type { WorldRepository } from './ports.ts';

/** A read only: missing receipt must never execute or retry the command. */
export async function checkMessageReceipt(
  deps: { worlds: Pick<WorldRepository, 'receipt'> },
  session: Session,
  command: TurnCommand,
): Promise<CommitResult | null> {
  validateCommand(command);
  return deps.worlds.receipt(session, command);
}
