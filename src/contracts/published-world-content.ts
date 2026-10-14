import { z } from 'zod';
import { Id } from './api.ts';
import {
  publicationContentIssues,
  publicationPlayerPreview,
  publicationSupport,
  publicationStorageIssues,
  PUBLICATION_LIFE_MODULE_MAX_CHARS,
  type PublicationContent,
  type PublicationJson,
} from '../modules/settings/domain/publication-content.ts';

const key = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => s.trim().length > 0, 'Empty text');
const at = z.iso.datetime();
const refs = (max: number) => z.array(key).max(max);
const visibility = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('player') }),
  z.strictObject({ kind: z.literal('world') }),
  z.strictObject({ kind: z.literal('actors'), actorKeys: refs(12).min(1) }),
]);
const participant = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('player') }),
  z.strictObject({ kind: z.literal('actor'), actorKey: key }),
]);
const window = z.strictObject({ notBefore: at, expiresAt: at });
const resolution = z.strictObject({
  nodeKey: key,
  outcomes: z
    .array(z.enum(['committed', 'declined', 'skipped', 'expired']))
    .min(1)
    .max(4),
});
const prerequisite = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('history_fact'), factKey: key }),
  z.strictObject({ kind: z.literal('after_committed_node'), nodeKey: key }),
  z.strictObject({ kind: z.literal('after_presented_node'), nodeKey: key }),
  z.strictObject({
    kind: z.literal('after_resolved_node'),
    nodeKey: key,
    outcomes: resolution.shape.outcomes,
  }),
  z.strictObject({ kind: z.literal('at_place'), placeKey: key }),
  z.strictObject({ kind: z.literal('not_before'), at }),
]);
const intent = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('editorial_only') }),
  z.strictObject({ kind: z.literal('director_event'), actorKey: key.optional() }),
  z.strictObject({ kind: z.literal('offer_message'), actorKey: key, text: text(500) }),
  z.strictObject({
    kind: z.literal('offer_invitation'),
    actorKeys: refs(12).min(1),
    placeKey: key,
    title: text(120),
    earliestAt: at,
  }),
]);
const json = z.unknown().transform((v) => v as PublicationJson);
const shape = z
  .strictObject({
    schemaVersion: z.literal(1),
    work: z.strictObject({
      key,
      title: text(80),
      hook: text(180),
      description: text(1600),
      experienceNote: text(300),
      coverMediaKey: key.optional(),
    }),
    world: z.strictObject({
      publicSetting: text(1600),
      tone: text(200),
      startAt: at,
      startPlaceKey: key,
      hiddenContext: text(4000),
    }),
    protagonist: z.strictObject({
      identity: text(300),
      situation: text(1000),
      knownFactKeys: refs(64),
    }),
    actors: z
      .array(
        z.strictObject({
          key,
          name: text(80),
          knownAtStart: z.boolean(),
          lifeModules: z
            .strictObject({
              lifeContext: text(PUBLICATION_LIFE_MODULE_MAX_CHARS).optional(),
              traits: text(PUBLICATION_LIFE_MODULE_MAX_CHARS).optional(),
              drives: text(PUBLICATION_LIFE_MODULE_MAX_CHARS).optional(),
              behavior: text(PUBLICATION_LIFE_MODULE_MAX_CHARS).optional(),
              relationships: text(PUBLICATION_LIFE_MODULE_MAX_CHARS).optional(),
            })
            .optional(),
          publicCard: z.strictObject({
            introduction: text(1600).optional(),
            identity: text(160).optional(),
            traits: z.array(text(60)).max(3),
            appearance: text(240).optional(),
            avatarMediaKey: key.optional(),
            momentsVisibility: z.enum(['all', 'three_days']).optional(),
          }),
          privatePersona: z.strictObject({
            background: text(1200),
            motivation: text(600),
            voice: text(600),
            boundaries: text(600),
          }),
        }),
      )
      .min(1)
      .max(12),
    relationships: z
      .array(
        z.strictObject({
          key,
          from: participant,
          to: participant,
          description: text(400),
          visibility,
        }),
      )
      .max(64),
    places: z
      .array(
        z.strictObject({
          key,
          name: text(100),
          aliases: z.array(text(100)).max(16).optional(),
          description: z.string().max(800),
          knownAtStart: z.boolean(),
          sceneMediaKey: key.optional(),
          sceneImage: z.strictObject({ assetId: Id }).optional(),
        }),
      )
      .min(1)
      .max(24),
    routes: z
      .array(
        z.strictObject({
          fromPlaceKey: key,
          toPlaceKey: key,
          minutes: z.number().int().min(1).max(1440),
        }),
      )
      .max(64),
    history: z
      .array(
        z.strictObject({
          key,
          kind: z.literal('established_fact'),
          text: text(1000),
          occurredAt: at,
          actorKeys: refs(12),
          placeKey: key.optional(),
          visibility,
        }),
      )
      .max(64),
    initialKnowledge: z.array(z.strictObject({ actorKey: key, factKeys: refs(64) })).max(12),
    phone: z.strictObject({
      messages: z
        .array(
          z
            .strictObject({
              key,
              actorKey: key,
              origin: z.enum(['history', 'incoming']),
              speaker: z.enum(['actor', 'player']).optional(),
              text: z.string().max(500),
              at,
              attachment: z
                .strictObject({
                  kind: z.enum(['image', 'video']),
                  assetId: Id,
                  label: z.string().trim().min(1).max(120).optional(),
                })
                .optional(),
            })
            .superRefine((message, ctx) => {
              if (!message.text.trim() && !message.attachment)
                ctx.addIssue({
                  code: 'custom',
                  path: ['text'],
                  message: 'message_content_required',
                });
            }),
        )
        .max(200),
      moments: z
        .array(
          z.strictObject({
            key,
            actorKey: key,
            text: text(1600),
            at,
            image: z.string().optional(),
            images: z.array(z.string()).max(9).optional(),
            visibility: z
              .strictObject({
                kind: z.literal('after_statement'),
                actorKey: key,
                statement: text(500),
              })
              .optional(),
          }),
        )
        .max(48)
        .optional(),
      notes: z
        .array(z.strictObject({ key, title: text(100), text: text(1600), factKeys: refs(64) }))
        .max(12),
      invitations: z
        .array(
          z.strictObject({
            key,
            actorKeys: refs(12).min(1),
            placeKey: key,
            messageKey: key,
            title: text(120),
            at,
            status: z.literal('proposed'),
          }),
        )
        .max(12),
      album: z
        .array(z.strictObject({ key, mediaKey: key, title: text(120), historyFactKey: key }))
        .max(24),
    }),
    media: z
      .array(
        z.strictObject({
          key,
          asset: z.strictObject({
            namespace: z.literal('publication'),
            key,
            revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
          }),
          use: z.enum(['cover', 'avatar', 'scene', 'album']),
          depiction: z.enum(['uploaded_image', 'illustration', 'generated_image']),
          label: text(160),
          visibility,
          url: z.string().optional(),
        }),
      )
      .max(64),
    openingEventKey: key.optional(),
    timeline: z
      .strictObject({
        initialStageKey: key,
        stages: z
          .array(
            z.strictObject({
              key,
              title: text(120),
              order: z.number().int().min(0).max(31),
              afterStageKeys: refs(8),
              window: window.optional(),
            }),
          )
          .min(1)
          .max(16),
      })
      .optional(),
    conditions: z
      .array(
        z.strictObject({
          key,
          title: text(120),
          match: z.enum(['all', 'any']),
          prerequisites: z.array(prerequisite).min(1).max(16),
        }),
      )
      .max(32)
      .optional(),
    candidates: z
      .array(
        z.strictObject({
          key,
          kind: z.literal('candidate'),
          title: text(120),
          editorialIntent: text(16384),
          script: text(16384).optional(),
          sceneText: z.string().max(1600).optional(),
          scenePlaceKeys: refs(32).optional(),
          direction: z
            .strictObject({
              mode: z.enum(['required', 'optional']),
              expectedImpact: text(1200).optional(),
              experience: text(1200).optional(),
              progress: z
                .strictObject({
                  pace: z.enum(['brief', 'standard', 'extended']).optional(),
                  refusal: z.enum(['defer', 'withdraw']).optional(),
                  completion: z
                    .strictObject({
                      mode: z.enum(['all', 'any']),
                      criteria: z
                        .array(
                          z.discriminatedUnion('kind', [
                            z.strictObject({
                              key,
                              kind: z.literal('invitation_response'),
                              response: z.enum(['accepted', 'declined']),
                            }),
                            z.strictObject({
                              key,
                              kind: z.literal('npc_exact_message'),
                              actorKey: key,
                              phrase: text(120),
                            }),
                          ]),
                        )
                        .min(1)
                        .max(8),
                    })
                    .optional(),
                })
                .optional(),
            })
            .optional(),
          actorKeys: refs(12),
          settingPlaceKey: key.optional(),
          placeKey: key.optional(),
          prerequisites: z.array(prerequisite).max(16),
          conditionKeys: refs(16).optional(),
          mutuallyExclusiveNodeKeys: refs(16),
          intent,
          timeline: z
            .strictObject({
              stageKey: key,
              window: window.optional(),
              timeNote: text(300).optional(),
              excludeIfResolved: z.array(resolution).max(16),
              alternatives: z.strictObject({
                onDeclined: refs(8),
                onSkipped: refs(8),
                onExpired: refs(8),
              }),
            })
            .optional(),
        }),
      )
      .max(32),
    extensions: z
      .array(
        z.strictObject({
          namespace: z.string().regex(/^[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{0,31}$/),
          version: z.number().int().min(1).max(999),
          purpose: z.enum(['editorial', 'runtime_required']),
          description: text(400),
          data: json,
        }),
      )
      .max(8),
  })
  .superRefine((value, ctx) => {
    for (const error of publicationContentIssues(value))
      ctx.addIssue({ code: 'custom', path: error.path, message: error.code });
  });
/** Explicit extension envelopes preserve unknown editorial data. All other unknown fields reject. */
export const PublishedWorldContentSchema = z
  .unknown()
  .superRefine((raw, ctx) => {
    for (const error of publicationStorageIssues(raw))
      ctx.addIssue({ code: 'custom', path: error.path, message: error.code });
  })
  .pipe(shape);
export type PublishedWorldContent = z.infer<typeof PublishedWorldContentSchema>;
/** Compile-time alignment without a domain dependency on Zod/contracts. */
const aligned: z.ZodType<PublicationContent> = PublishedWorldContentSchema;
void aligned;

/** Public entry points parse the whole stored contract before returning whitelisted previews/status. */
export function previewPublishedWorldContent(raw: unknown) {
  return publicationPlayerPreview(PublishedWorldContentSchema.parse(raw));
}
export function inspectPublishedWorldSupport(
  raw: unknown,
  supported: ReadonlySet<string> = new Set(),
) {
  return publicationSupport(PublishedWorldContentSchema.parse(raw), supported);
}
