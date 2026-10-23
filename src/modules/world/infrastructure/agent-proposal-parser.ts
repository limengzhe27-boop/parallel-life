import {
  normalizeStickerStatement,
  stickerFitsStatement,
} from '../domain/sticker-expression.ts';
import { attachAgentFailure } from '../application/agent-failure-diagnostic.ts';
import { AgentProposalSchema, STICKER_IDS } from './agent-proposal-schema.ts';
import { decodeNpcWire } from './npc-model-protocol.ts';
import type { AgentProposal } from '../domain/agent-runtime.ts';
import {
  AgentValidationError,
  validateAgentProposal,
  type AgentValidationContext,
} from '../domain/agent-kernel.ts';
/** Keep the coarse reason stable while adding just enough detail to diagnose a bad model reply. */
export function describeShapeIssues(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  limit = 3,
): string {
  return issues
    .slice(0, limit)
    .map((issue) => {
      const path = issue.path
        .filter(
          (part): part is string | number => typeof part === 'string' || typeof part === 'number',
        )
        .join('.');
      return `${path || '(root)'}=${issue.message}`;
    })
    .join('|');
}

const reject = (reason: string): never => {
  throw new AgentValidationError(reason);
};

/** Backward-compatible transport normalization only; saved raw responses stay unchanged. */
function normalizeExpressionMarkers(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const object = value as Record<string, unknown>;
  if (!Array.isArray(object.statements)) return value;
  const statements = object.statements.flatMap((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [raw];
    const statement = normalizeStickerStatement(raw) as Record<string, unknown>;
    if (typeof statement.text !== 'string') return [raw];
    const text = statement.text.trim();
    const sticker = /^\[\[sticker:([a-z_]+)\]\]$/.exec(text);
    if (sticker && (STICKER_IDS as readonly string[]).includes(sticker[1]!))
      return [{ ...statement, text: '', stickerId: sticker[1] }];
    if (text === '[[recall:last]]') return [];
    // A sticker is its own message. Split legacy/model combined bubbles without
    // dropping the text, its reply intent or its dependency binding.
    if (
      typeof statement.stickerId === 'string' &&
      text.length > 0 &&
      !stickerFitsStatement(text, statement.stickerId)
    ) {
      const textOnly = { ...statement };
      delete textOnly.stickerId;
      return [textOnly];
    }
    if (typeof statement.stickerId === 'string' && text.length > 0) {
      const textOnly = { ...statement };
      delete textOnly.stickerId;
      const stickerOnly = {
        ...statement,
        text: '',
        requestsPlayerReply: undefined,
        questionForResponsibilityId: undefined,
      };
      return [textOnly, stickerOnly];
    }
    return [statement];
  });
  // v67 emits text and sticker as separate statements. A pure sticker that
  // follows comfort/apology/serious complaint must be judged against that
  // preceding sentence too, not only against a combined statement.
  let precedingText = '';
  const expressionStatements = statements.filter((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return true;
    const statement = raw as Record<string, unknown>;
    const text = typeof statement.text === 'string' ? statement.text.trim() : '';
    if (text) {
      precedingText = text;
      return true;
    }
    return !(
      typeof statement.stickerId === 'string' &&
      precedingText.length > 0 &&
      !stickerFitsStatement(precedingText, statement.stickerId)
    );
  });
  const recall = object.statements.some(
    (raw) =>
      raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      typeof (raw as { text?: unknown }).text === 'string' &&
      (raw as { text: string }).text.trim() === '[[recall:last]]',
  );
  if (recall && object.protocol === 'npc-wire-v15') {
    const changes =
      object.changes && typeof object.changes === 'object' && !Array.isArray(object.changes)
        ? (object.changes as Record<string, unknown>)
        : {};
    return { ...object, statements: expressionStatements, changes: { ...changes, recallLast: true } };
  }
  return {
    ...object,
    statements: expressionStatements,
    ...(recall ? { recallLast: true } : {}),
  };
}
/** Strict public model protocol; no regex-based dialogue-to-physical-execution inference. */
export function parseAgentProposal(context: AgentValidationContext, raw: unknown): AgentProposal {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > 180000) reject('RESPONSE_LIMIT');
    try {
      // A single transport wrapper is not a different proposal. Do not extract
      // JSON from prose, repair truncated output, or change the saved raw response.
      const envelope = raw.trim().match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
      parsed = JSON.parse(envelope ? envelope[1]! : raw);
    } catch {
      reject('RESPONSE_JSON');
    }
  }
  try {
    parsed = decodeNpcWire(context, normalizeExpressionMarkers(parsed));
  } catch (error) {
    throw attachAgentFailure(
      new AgentValidationError('RESPONSE_WIRE_SHAPE'),
      'decode',
      undefined,
      error,
    );
  }
  const result = AgentProposalSchema.safeParse(parsed);
  if (!result.success) reject(`RESPONSE_SHAPE:${describeShapeIssues(result.error.issues)}`);
  const proposal = result.data!;
  validateAgentProposal(context, proposal);
  return proposal;
}
