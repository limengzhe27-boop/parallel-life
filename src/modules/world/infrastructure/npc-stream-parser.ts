import { normalizeStickerStatement } from '../domain/sticker-expression.ts';
import { z } from 'zod';
import { NPC_WIRE_PROTOCOL, CURRENT_NPC_WIRE_PROTOCOL } from './npc-model-protocol.ts';
import {
  classifyNpcStreamStatement,
  type NpcParsedStreamEvent,
  type NpcStreamStatementDraft,
  type NpcStreamUnitKind,
} from '../domain/npc-stream-segment.ts';

export type { NpcParsedStreamEvent };

const StatementWireElementSchema = z
  .strictObject({
    text: z.string().trim().max(12000),
    stickerId: z.string().min(1).max(24).nullable().optional(),
    dependsOnActionIds: z.array(z.string().min(1).max(240)).max(16),
    requestsPlayerReply: z.boolean().nullable().optional(),
    questionForResponsibilityId: z.string().min(1).max(240).nullable().optional(),
  })
  .refine(
    (statement) => statement.text.length > 0 || typeof statement.stickerId === 'string',
    'empty statement',
  );

export class NpcStreamParser {
  private readonly channelKind: 'private' | 'group' | 'scene';
  private readonly inputOrigin: 'player' | 'wake' | 'coordination';
  private readonly existingResponsibilityIds: readonly string[];

  private rawBuffer = '';
  private cursor = 0;

  private inString = false;
  private escaped = false;
  private stringStart = -1;
  private lastCompletedTopKey: string | null = null;

  private rootStarted = false;
  private braceDepth = 0;
  private bracketDepth = 0;

  private awaitingTopLevelValueForKey: string | null = null;
  private activeTopLevelKey: string | null = null;
  private topLevelValueStart = -1;

  private inStatementsArray = false;
  private statementsBracketDepth = 0;
  private currentStatementStart = -1;
  private currentStatementBraceDepth = 0;
  private nextSegmentIndex = 0;

  private priorDependentSeen = false;
  private haltedByError = false;
  private executionCapabilities: string[] = [];
  private readonly seenCriticalKeys = new Set<string>();
  private protocol: string | null = null;
  private statementsComplete = false;
  private parsedExecutions: unknown[] | null = null;
  private executionIntentsEmitted = false;

  constructor(options: {
    channelKind: 'private' | 'group' | 'scene';
    inputOrigin: 'player' | 'wake' | 'coordination';
    existingResponsibilityIds: readonly string[];
  }) {
    this.channelKind = options.channelKind;
    this.inputOrigin = options.inputOrigin;
    this.existingResponsibilityIds = options.existingResponsibilityIds;
  }

  get rawText(): string {
    return this.rawBuffer;
  }

  get hasOpenStatement(): boolean {
    return this.currentStatementStart !== -1;
  }

  get parsedSegmentCount(): number {
    return this.nextSegmentIndex;
  }

  pushChunk(chunk: string): NpcParsedStreamEvent[] {
    if (!chunk || this.haltedByError) {
      if (chunk) this.rawBuffer += chunk;
      return [];
    }
    this.rawBuffer += chunk;
    const events: NpcParsedStreamEvent[] = [];

    while (this.cursor < this.rawBuffer.length && !this.haltedByError) {
      const ch = this.rawBuffer[this.cursor]!;

      if (this.inString) {
        if (this.escaped) {
          this.escaped = false;
        } else if (ch === '\\') {
          this.escaped = true;
        } else if (ch === '"') {
          this.inString = false;
          const rawStringToken = this.rawBuffer.slice(this.stringStart, this.cursor + 1);
          this.stringStart = -1;
          if (
            this.activeTopLevelKey === 'protocol' &&
            this.braceDepth === 1 &&
            this.bracketDepth === 0
          ) {
            try {
              this.protocol = JSON.parse(rawStringToken) as string;
              this.emitExecutionIntents(events);
            } catch {
              // The full protocol parser rejects malformed strings.
            }
          }
          if (
            this.braceDepth === 1 &&
            this.bracketDepth === 0 &&
            !this.activeTopLevelKey &&
            this.awaitingTopLevelValueForKey === null
          ) {
            try {
              this.lastCompletedTopKey = JSON.parse(rawStringToken) as string;
            } catch {
              this.lastCompletedTopKey = null;
            }
          }
        }
        this.cursor += 1;
        continue;
      }

      if (!this.rootStarted) {
        if (ch === '{') {
          this.rootStarted = true;
          this.braceDepth = 1;
        } else if (!/\s/.test(ch)) {
          this.haltedByError = true;
          events.push({
            kind: 'statement_error',
            segmentIndex: this.nextSegmentIndex,
            code: 'STREAM_ROOT_NOT_OBJECT',
          });
          break;
        }
        this.cursor += 1;
        continue;
      }

      // Detect top-level key ':' and value start before handling quotes/braces
      if (this.braceDepth === 1 && this.bracketDepth === 0 && !this.activeTopLevelKey) {
        if (ch === ':' && this.lastCompletedTopKey !== null) {
          this.awaitingTopLevelValueForKey = this.lastCompletedTopKey;
          this.lastCompletedTopKey = null;
          this.cursor += 1;
          continue;
        }
        if (this.awaitingTopLevelValueForKey !== null && !/\s/.test(ch)) {
          const key = this.awaitingTopLevelValueForKey;
          this.awaitingTopLevelValueForKey = null;
          this.activeTopLevelKey = key;
          this.topLevelValueStart = this.cursor;
          if (['protocol', 'statements', 'executions'].includes(key)) {
            if (this.seenCriticalKeys.has(key)) {
              this.haltedByError = true;
              events.push({
                kind: 'statement_error',
                segmentIndex: this.nextSegmentIndex,
                code: 'STREAM_DUPLICATE_TOP_LEVEL_KEY',
              });
              break;
            }
            this.seenCriticalKeys.add(key);
          }
          if (key === 'statements') {
            if (ch === '[') {
              this.inStatementsArray = true;
              this.statementsBracketDepth = this.bracketDepth + 1;
            } else {
              this.haltedByError = true;
              events.push({
                kind: 'statement_error',
                segmentIndex: this.nextSegmentIndex,
                code: 'STREAM_STATEMENTS_NOT_ARRAY',
              });
              this.cursor += 1;
              break;
            }
          }
        }
      }

      if (ch === '"') {
        this.inString = true;
        this.escaped = false;
        this.stringStart = this.cursor;
        this.cursor += 1;
        continue;
      }

      // Track elements inside "statements": [...]
      if (this.inStatementsArray) {
        if (
          this.currentStatementStart === -1 &&
          this.bracketDepth === this.statementsBracketDepth &&
          this.braceDepth === 1
        ) {
          if (ch === '{') {
            this.currentStatementStart = this.cursor;
            this.currentStatementBraceDepth = this.braceDepth + 1;
          } else if (ch !== ']' && ch !== ',' && !/\s/.test(ch)) {
            this.haltedByError = true;
            events.push({
              kind: 'statement_error',
              segmentIndex: this.nextSegmentIndex,
              code: 'STREAM_STATEMENT_NOT_OBJECT',
            });
            this.cursor += 1;
            break;
          }
        }
      }

      // Update structural depths
      if (ch === '{') {
        this.braceDepth += 1;
      } else if (ch === '}') {
        this.braceDepth -= 1;
      } else if (ch === '[') {
        this.bracketDepth += 1;
      } else if (ch === ']') {
        this.bracketDepth -= 1;
      }

      // Check if an individual statement object inside "statements": [...] just closed
      if (
        this.inStatementsArray &&
        this.currentStatementStart !== -1 &&
        ch === '}' &&
        this.braceDepth === this.currentStatementBraceDepth - 1 &&
        this.bracketDepth === this.statementsBracketDepth
      ) {
        const rawStatement = this.rawBuffer.slice(this.currentStatementStart, this.cursor + 1);
        this.currentStatementStart = -1;
        this.currentStatementBraceDepth = 0;
        const segmentIndex = this.nextSegmentIndex;
        this.nextSegmentIndex += 1;

        const parsedEvent = this.parseAndClassifyStatement(rawStatement, segmentIndex);
        events.push(parsedEvent);
        if (parsedEvent.kind === 'statement_error') {
          this.haltedByError = true;
          this.cursor += 1;
          break;
        }
      }

      // Check if the "statements" array itself closed
      if (
        this.inStatementsArray &&
        ch === ']' &&
        this.bracketDepth === 0 &&
        this.braceDepth === 1
      ) {
        this.inStatementsArray = false;
        this.statementsBracketDepth = 0;
        try {
          const values = JSON.parse(this.rawBuffer.slice(this.topLevelValueStart, this.cursor + 1));
          this.statementsComplete = z.array(StatementWireElementSchema).safeParse(values).success;
        } catch {
          this.statementsComplete = false;
        }
        this.emitExecutionIntents(events);
      }

      if (
        this.activeTopLevelKey === 'executions' &&
        ch === ']' &&
        this.bracketDepth === 0 &&
        this.braceDepth === 1
      ) {
        this.recordParsedExecutions(this.rawBuffer.slice(this.topLevelValueStart, this.cursor + 1));
        this.emitExecutionIntents(events);
      }

      // Top-level property ends at ',' (braceDepth === 1, bracketDepth === 0) or root '}' (braceDepth === 0, bracketDepth === 0)
      if (
        this.activeTopLevelKey !== null &&
        this.bracketDepth === 0 &&
        ((ch === ',' && this.braceDepth === 1) || (ch === '}' && this.braceDepth === 0))
      ) {
        if (this.activeTopLevelKey === 'executions' && this.topLevelValueStart !== -1) {
          const rawValue = this.rawBuffer.slice(this.topLevelValueStart, this.cursor).trim();
          this.recordParsedExecutions(rawValue);
          this.emitExecutionIntents(events);
        }
        this.activeTopLevelKey = null;
        this.topLevelValueStart = -1;
      }

      this.cursor += 1;
    }

    return events;
  }

  private recordParsedExecutions(rawValue: string): void {
    if (!rawValue || rawValue === 'null') return;
    try {
      const parsed = JSON.parse(rawValue) as unknown;
      if (!Array.isArray(parsed)) return;
      this.parsedExecutions = parsed;
      const caps: string[] = [];
      for (const item of parsed) {
        const cap = (item as { action?: { capability?: unknown } } | null)?.action?.capability;
        if (typeof cap === 'string' && cap.trim()) {
          caps.push(cap.trim());
        }
      }
      this.executionCapabilities = caps;
    } catch {
      // Full wire parser will reject invalid executions on turn completion.
    }
  }

  private emitExecutionIntents(events: NpcParsedStreamEvent[]): void {
    if (
      this.executionIntentsEmitted ||
      this.haltedByError ||
      !this.statementsComplete ||
      ![NPC_WIRE_PROTOCOL, CURRENT_NPC_WIRE_PROTOCOL].includes(this.protocol ?? '') ||
      this.parsedExecutions === null
    )
      return;
    this.executionIntentsEmitted = true;
    events.push({
      kind: 'execution_intents',
      protocol: this.protocol!,
      executions: this.parsedExecutions,
    });
  }

  private parseAndClassifyStatement(
    rawStatement: string,
    segmentIndex: number,
  ): NpcParsedStreamEvent {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawStatement);
    } catch {
      return {
        kind: 'statement_error',
        segmentIndex,
        code: 'STREAM_STATEMENT_INVALID_JSON',
      };
    }

    const validated = StatementWireElementSchema.safeParse(normalizeStickerStatement(parsedJson));
    if (!validated.success) {
      return {
        kind: 'statement_error',
        segmentIndex,
        code: 'STREAM_STATEMENT_SCHEMA_INVALID',
      };
    }

    const data = validated.data;
    const draft: NpcStreamStatementDraft = {
      segmentIndex,
      text: data.text,
      ...(typeof data.stickerId === 'string' ? { stickerId: data.stickerId } : {}),
      dependsOnActionIds: data.dependsOnActionIds,
      ...(typeof data.requestsPlayerReply === 'boolean'
        ? { requestsPlayerReply: data.requestsPlayerReply }
        : {}),
      ...(typeof data.questionForResponsibilityId === 'string'
        ? { questionForResponsibilityId: data.questionForResponsibilityId }
        : {}),
    };

    const classification = classifyNpcStreamStatement({
      statement: draft,
      channelKind: this.channelKind,
      inputOrigin: this.inputOrigin,
      priorDependentSeen: this.priorDependentSeen,
      existingResponsibilityIds: this.existingResponsibilityIds,
      executionCapabilities: this.executionCapabilities,
    });

    if (classification.unitKind === 'dependent_statement') {
      this.priorDependentSeen = true;
    }

    return {
      kind: 'statement',
      statement: draft,
      unitKind: classification.unitKind,
      ...(classification.reason ? { withheldReason: classification.reason } : {}),
    };
  }
}
