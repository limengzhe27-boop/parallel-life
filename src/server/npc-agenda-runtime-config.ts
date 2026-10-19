import {
  DEFAULT_OWN_AGENDA_RUNTIME_CONFIG,
  type OwnAgendaRuntimeConfig,
} from '../modules/world/infrastructure/own-agenda-review-authority.ts';
/** Only server composition reads operational configuration; grants never carry spending limits. */
export function npcAgendaRuntimeConfig(
  env: Record<string, string | undefined>,
): OwnAgendaRuntimeConfig {
  const config = structuredClone(DEFAULT_OWN_AGENDA_RUNTIME_CONFIG);
  const number = (key: string, fallback: number, integer = true) => {
    const n = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isSafeInteger(n)))
      throw Error('INVALID_NPC_AGENDA_CONFIGURATION');
    return n;
  };
  config.policy.storyGapMs = number('NPC_AGENDA_REVIEW_STORY_GAP_MS', config.policy.storyGapMs);
  config.policy.realGapMs = number('NPC_AGENDA_REVIEW_REAL_GAP_MS', config.policy.realGapMs);
  config.policy.maxRealGapMs = number(
    'NPC_AGENDA_REVIEW_MAX_REAL_GAP_MS',
    config.policy.maxRealGapMs,
  );
  config.policy.quietBackoffMultiplier = number(
    'NPC_AGENDA_REVIEW_QUIET_BACKOFF',
    config.policy.quietBackoffMultiplier,
    false,
  );
  if (
    config.policy.quietBackoffMultiplier < 1 ||
    config.policy.maxRealGapMs < config.policy.realGapMs
  )
    throw Error('INVALID_NPC_AGENDA_CONFIGURATION');
  for (const dimension of ['owner', 'world', 'actor'] as const)
    config.budgets = {
      ...config.budgets,
      [dimension]: {
        limit: number(
          `NPC_AGENDA_REVIEW_${dimension.toUpperCase()}_LIMIT`,
          config.budgets[dimension].limit,
        ),
        windowSeconds: number(
          `NPC_AGENDA_REVIEW_${dimension.toUpperCase()}_WINDOW_SECONDS`,
          config.budgets[dimension].windowSeconds,
        ),
      },
    };
  return config;
}
