import { PUBLICATION_ART } from '../../contracts/publication-assets.ts';

export type ActorEditorForm = {
  key: string;
  name: string;
  // Section 1: 名字与身份
  identity: string;
  appearance: string;
  traits: string[];
  avatarMediaKey?: string;
  knownAtStart: boolean;
  // Section 2: 与主角的初始关系
  relationshipToPlayer: string;
  // Section 3: 性格与说话方式
  voice: string;
  background: string;
  // Section 4: 她想要什么 (在乎什么 / 眼前想法)
  caresAbout: string;
  immediateGoal: string;
  rawMotivation: string;
  // Section 5: 关系与边界 (知情范围 / 底线)
  boundaries: string;
  knownFactKeys: string[];
};

export type WorldSettingsForm = {
  title: string;
  hook: string;
  description: string;
  experienceNote: string;
  coverMediaKey?: string;
  publicSetting: string;
  tone: string;
  startAt: string;
  startPlaceKey: string;
  hiddenContext: string;
  protagonistIdentity: string;
  protagonistSituation: string;
};

export type CandidateSummary = {
  key: string;
  title: string;
  editorialIntent: string;
  actorKeys: string[];
  placeKey?: string;
  stageKey?: string;
};

export type PlotEditorForm = {
  history: Array<{
    key: string;
    text: string;
    occurredAt: string;
    actorKeys: string[];
  }>;
  candidates: CandidateSummary[];
};

/** Deep clones a JSON-compatible object without prototype pollution. */
export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as unknown as T;
  }
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    Object.defineProperty(copy, k, {
      value: deepClone(v),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return copy as T;
}

/** Recursively removes undefined values from objects so storage schema treats them as valid JSON. */
export function pruneUndefinedDeep(obj: unknown): void {
  if (obj === null || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach(pruneUndefinedDeep);
    return;
  }
  const record = obj as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) {
      delete record[key];
    } else if (value && typeof value === 'object') {
      pruneUndefinedDeep(value);
    }
  }
}

/** Generates a unique, valid actor key matching /^[a-z][a-z0-9_]{0,31}$/. */
export function generateActorKey(existingKeys: string[], prefix = 'actor'): string {
  const safePrefix =
    prefix
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .slice(0, 12) || 'actor';
  const cleanPrefix = /^[a-z]/.test(safePrefix) ? safePrefix : `a_${safePrefix}`;
  let count = existingKeys.length + 1;
  while (true) {
    const candidate = `${cleanPrefix}_${count}`.slice(0, 31);
    if (!existingKeys.includes(candidate)) {
      return candidate;
    }
    count++;
  }
}

/**
 * Parses dual motivation fields (在乎什么 / 眼前想法) from stored motivation string.
 * Preserves raw motivation to ensure lossless round-trip when not formatted.
 */
export function splitMotivation(raw: string): {
  caresAbout: string;
  immediateGoal: string;
  raw: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { caresAbout: '', immediateGoal: '', raw: '' };
  }
  // Check common dual format patterns
  const match = trimmed.match(/^在乎[：:][ \t]*(.*?)(?:\r?\n|[;；])[ \t]*眼前[：:][ \t]*(.*)$/s);
  if (match) {
    return {
      caresAbout: match[1]?.trim() ?? '',
      immediateGoal: match[2]?.trim() ?? '',
      raw: trimmed,
    };
  }
  return {
    caresAbout: trimmed,
    immediateGoal: '',
    raw: trimmed,
  };
}

/** Formats caresAbout and immediateGoal back into a motivation text. */
export function joinMotivation(
  caresAbout: string,
  immediateGoal: string,
  fallbackRaw = '',
): string {
  const original = splitMotivation(fallbackRaw);
  if (original.caresAbout === caresAbout && original.immediateGoal === immediateGoal)
    return fallbackRaw;
  const cleanCares = caresAbout.trim();
  const cleanGoal = immediateGoal.trim();
  if (!cleanCares && !cleanGoal) return '';
  return `在乎：${cleanCares}\n眼前：${cleanGoal}`;
}

/** Parses raw actor data into the 5-section editor form. */
export function parseActorEditor(
  actor: Record<string, unknown>,
  content: Record<string, unknown>,
): ActorEditorForm {
  const key = String(actor.key ?? '');
  const name = String(actor.name ?? '');
  const knownAtStart = Boolean(actor.knownAtStart ?? true);

  const publicCard = (
    actor.publicCard && typeof actor.publicCard === 'object' ? actor.publicCard : {}
  ) as Record<string, unknown>;
  const privatePersona = (
    actor.privatePersona && typeof actor.privatePersona === 'object' ? actor.privatePersona : {}
  ) as Record<string, unknown>;

  // Section 1: 名字与身份
  const identity = typeof publicCard.identity === 'string' ? publicCard.identity : '';
  const appearance = typeof publicCard.appearance === 'string' ? publicCard.appearance : '';
  const traits = Array.isArray(publicCard.traits)
    ? publicCard.traits.filter((t): t is string => typeof t === 'string')
    : [];
  const defaultAvatarKey =
    PUBLICATION_ART.find((a) => a.uses.includes('avatar'))?.key ?? 'qingqing';
  const avatarMediaKey =
    typeof publicCard.avatarMediaKey === 'string' && publicCard.avatarMediaKey
      ? publicCard.avatarMediaKey
      : defaultAvatarKey;

  // Section 2: 与主角初始关系
  let relationshipToPlayer = '';
  if (Array.isArray(content.relationships)) {
    for (const rel of content.relationships) {
      if (!rel || typeof rel !== 'object') continue;
      const r = rel as Record<string, unknown>;
      const from = r.from as Record<string, unknown> | undefined;
      const to = r.to as Record<string, unknown> | undefined;
      const isActorFrom = from?.kind === 'actor' && from?.actorKey === key && to?.kind === 'player';
      const isActorTo = from?.kind === 'player' && to?.kind === 'actor' && to?.actorKey === key;
      if (isActorFrom || isActorTo) {
        if (typeof r.description === 'string') {
          relationshipToPlayer = r.description;
          break;
        }
      }
    }
  }

  // Section 3: 性格与说话方式
  const voice = typeof privatePersona.voice === 'string' ? privatePersona.voice : '';
  const background = typeof privatePersona.background === 'string' ? privatePersona.background : '';

  // Section 4: 动机与眼前目标
  const rawMotivation =
    typeof privatePersona.motivation === 'string' ? privatePersona.motivation : '';
  const { caresAbout, immediateGoal } = splitMotivation(rawMotivation);

  // Section 5: 底线与知情范围
  const boundaries = typeof privatePersona.boundaries === 'string' ? privatePersona.boundaries : '';
  let knownFactKeys: string[] = [];
  if (Array.isArray(content.initialKnowledge)) {
    const entry = content.initialKnowledge.find(
      (k) => k && typeof k === 'object' && (k as Record<string, unknown>).actorKey === key,
    ) as Record<string, unknown> | undefined;
    if (entry && Array.isArray(entry.factKeys)) {
      knownFactKeys = entry.factKeys.filter((f): f is string => typeof f === 'string');
    }
  }

  return {
    key,
    name,
    identity,
    appearance,
    traits,
    avatarMediaKey,
    knownAtStart,
    relationshipToPlayer,
    voice,
    background,
    caresAbout,
    immediateGoal,
    rawMotivation,
    boundaries,
    knownFactKeys,
  };
}

/** Updates actor details inside content without losing any unknown fields or unedited actors. */
export function updateActorInContent(
  content: Record<string, unknown>,
  form: ActorEditorForm,
): Record<string, unknown> {
  const next = deepClone(content);
  const actors = Array.isArray(next.actors) ? (next.actors as Record<string, unknown>[]) : [];
  const actorIdx = actors.findIndex((a) => a && a.key === form.key);
  const original = actorIdx >= 0 ? parseActorEditor(actors[actorIdx]!, content) : null;
  const changed = (field: keyof ActorEditorForm) =>
    !original || JSON.stringify(original[field]) !== JSON.stringify(form[field]);

  const motivationText = joinMotivation(form.caresAbout, form.immediateGoal, form.rawMotivation);

  if (form.avatarMediaKey && changed('avatarMediaKey')) {
    const art = PUBLICATION_ART.find(
      (a) => a.key === form.avatarMediaKey && a.uses.includes('avatar'),
    );
    if (art) {
      const list = Array.isArray(next.media) ? (next.media as Record<string, unknown>[]) : [];
      if (!list.some((m) => m?.key === art.key)) {
        list.push({
          key: art.key,
          asset: { namespace: 'publication', key: art.key, revision: art.revision },
          use: 'avatar',
          depiction: 'generated_image',
          label: art.label,
          visibility: { kind: 'world' },
        });
        next.media = list;
      }
    }
  }

  const existingPublicCard =
    (actorIdx >= 0 ? (actors[actorIdx]?.publicCard as Record<string, unknown>) : null) ?? {};
  const existingPrivatePersona =
    (actorIdx >= 0 ? (actors[actorIdx]?.privatePersona as Record<string, unknown>) : null) ?? {};

  const publicCard: Record<string, unknown> = {
    ...existingPublicCard,
    ...(changed('traits') ? { traits: form.traits.filter((t) => t.trim().length > 0) } : {}),
    ...(changed('identity')
      ? form.identity.trim()
        ? { identity: form.identity.trim() }
        : {}
      : {}),
    ...(changed('appearance')
      ? form.appearance.trim()
        ? { appearance: form.appearance.trim() }
        : {}
      : {}),
    ...(changed('avatarMediaKey')
      ? form.avatarMediaKey
        ? { avatarMediaKey: form.avatarMediaKey }
        : {}
      : {}),
  };
  if (changed('identity') && !form.identity.trim()) delete publicCard.identity;
  if (changed('appearance') && !form.appearance.trim()) delete publicCard.appearance;
  if (changed('avatarMediaKey') && !form.avatarMediaKey) delete publicCard.avatarMediaKey;

  const privatePersona: Record<string, unknown> = {
    ...existingPrivatePersona,
    ...(changed('background') ? { background: form.background.trim() || '暂无详细背景' } : {}),
    ...(changed('voice') ? { voice: form.voice.trim() || '自然生活化语气' } : {}),
    ...(changed('caresAbout') || changed('immediateGoal')
      ? { motivation: motivationText || '按既定处境与玩家互动' }
      : {}),
    ...(changed('boundaries')
      ? { boundaries: form.boundaries.trim() || '不脱离当前世界与人物底色' }
      : {}),
  };

  if (actorIdx < 0) {
    if (!publicCard.avatarMediaKey && form.avatarMediaKey)
      publicCard.avatarMediaKey = form.avatarMediaKey;
    if (!privatePersona.background)
      privatePersona.background = form.background.trim() || '暂无详细背景';
    if (!privatePersona.voice) privatePersona.voice = form.voice.trim() || '自然生活化语气';
    if (!privatePersona.motivation)
      privatePersona.motivation = motivationText || '按既定处境与玩家互动';
    if (!privatePersona.boundaries)
      privatePersona.boundaries = form.boundaries.trim() || '不脱离当前世界与人物底色';
    if (!Array.isArray(publicCard.traits)) publicCard.traits = ['日常', '随和'];
  }

  const updatedActor: Record<string, unknown> = {
    ...(actorIdx >= 0 ? actors[actorIdx] : {}),
    key: form.key,
    ...(changed('name') ? { name: form.name.trim() || `人物_${form.key}` } : {}),
    ...(changed('knownAtStart')
      ? typeof form.knownAtStart === 'boolean'
        ? { knownAtStart: form.knownAtStart }
        : {}
      : {}),
    publicCard,
    privatePersona,
  };
  if (changed('knownAtStart') && typeof form.knownAtStart !== 'boolean') {
    delete updatedActor.knownAtStart;
  }

  if (actorIdx >= 0) {
    actors[actorIdx] = updatedActor;
  } else {
    actors.push(updatedActor);
  }
  next.actors = actors;
  pruneUndefinedDeep(next);

  // Update initial relationship with player in content.relationships
  if (changed('relationshipToPlayer') && Array.isArray(next.relationships)) {
    const rels = next.relationships as Record<string, unknown>[];
    let found = false;
    for (let i = 0; i < rels.length; i++) {
      const r = rels[i];
      if (!r || typeof r !== 'object') continue;
      const from = r.from as Record<string, unknown> | undefined;
      const to = r.to as Record<string, unknown> | undefined;
      const isActorFrom =
        from?.kind === 'actor' && from?.actorKey === form.key && to?.kind === 'player';
      const isActorTo =
        from?.kind === 'player' && to?.kind === 'actor' && to?.actorKey === form.key;
      if (isActorFrom || isActorTo) {
        rels[i] = {
          ...r,
          description: form.relationshipToPlayer.trim(),
        };
        found = true;
        break;
      }
    }
    if (!found && form.relationshipToPlayer.trim()) {
      const relKey = generateActorKey(
        rels.map((r) => String(r?.key ?? '')),
        'relation',
      );
      rels.push({
        key: relKey,
        from: { kind: 'actor', actorKey: form.key },
        to: { kind: 'player' },
        description: form.relationshipToPlayer.trim(),
        visibility: { kind: 'player' },
      });
    }
    next.relationships = rels;
  } else if (changed('relationshipToPlayer') && form.relationshipToPlayer.trim()) {
    next.relationships = [
      {
        key: `rel_${form.key}_player`.slice(0, 31),
        from: { kind: 'actor', actorKey: form.key },
        to: { kind: 'player' },
        description: form.relationshipToPlayer.trim(),
        visibility: { kind: 'player' },
      },
    ];
  }

  // Update initialKnowledge
  if (changed('knownFactKeys') && Array.isArray(next.initialKnowledge)) {
    const knowledgeList = next.initialKnowledge as Record<string, unknown>[];
    const kIdx = knowledgeList.findIndex((k) => k.actorKey === form.key);
    if (kIdx >= 0) {
      knowledgeList[kIdx] = {
        ...knowledgeList[kIdx],
        factKeys: form.knownFactKeys,
      };
    } else if (changed('knownFactKeys') && form.knownFactKeys.length > 0) {
      knowledgeList.push({
        actorKey: form.key,
        factKeys: form.knownFactKeys,
      });
    }
    next.initialKnowledge = knowledgeList;
  } else if (changed('knownFactKeys') && form.knownFactKeys.length > 0) {
    next.initialKnowledge = [
      {
        actorKey: form.key,
        factKeys: form.knownFactKeys,
      },
    ];
  }

  return next;
}

/** Creates a fresh empty actor state with a guaranteed unique key. */
export function createEmptyActor(existingKeys: string[]): ActorEditorForm {
  return {
    key: generateActorKey(existingKeys),
    name: '',
    identity: '',
    appearance: '',
    traits: [],
    avatarMediaKey:
      PUBLICATION_ART.find((a) => a.uses.includes('avatar'))?.key ?? 'qingqing',
    knownAtStart: true,
    relationshipToPlayer: '',
    voice: '',
    background: '',
    caresAbout: '',
    immediateGoal: '',
    rawMotivation: '',
    boundaries: '',
    knownFactKeys: [],
  };
}

export type ActorReference = {
  category:
    'relationship' | 'message' | 'moment' | 'invitation' | 'history' | 'candidate' | 'visibility';
  key: string;
  label: string;
};

/** Checks whether an actor is referenced in other sections to prevent accidental plot destruction. */
export function checkActorDeletionSafety(
  content: Record<string, unknown>,
  actorKey: string,
): { canDelete: boolean; references: ActorReference[] } {
  const references: ActorReference[] = [];

  // Check relationships (between this actor and other non-player actors, or important ones)
  if (Array.isArray(content.relationships)) {
    for (const rel of content.relationships as Record<string, unknown>[]) {
      if (!rel || typeof rel !== 'object') continue;
      const from = rel.from as Record<string, unknown> | undefined;
      const to = rel.to as Record<string, unknown> | undefined;
      if (
        (from?.kind === 'actor' && from?.actorKey === actorKey) ||
        (to?.kind === 'actor' && to?.actorKey === actorKey)
      ) {
        references.push({
          category: 'relationship',
          key: String(rel.key ?? ''),
          label: `人际关系: ${String(rel.description ?? rel.key)}`,
        });
      }
    }
  }

  // Check phone messages
  const phone = content.phone as Record<string, unknown> | undefined;
  if (phone && Array.isArray(phone.messages)) {
    for (const msg of phone.messages as Record<string, unknown>[]) {
      if (msg?.actorKey === actorKey) {
        references.push({
          category: 'message',
          key: String(msg.key ?? ''),
          label: `初始消息: ${String(msg.text ?? msg.key).slice(0, 20)}`,
        });
      }
    }
  }

  if (phone && Array.isArray(phone.moments)) {
    for (const moment of phone.moments as Record<string, unknown>[])
      if (moment?.actorKey === actorKey)
        references.push({
          category: 'moment',
          key: String(moment.key ?? ''),
          label: `朋友圈: ${String(moment.text ?? '').slice(0, 20)}`,
        });
  }

  // Check phone invitations
  if (phone && Array.isArray(phone.invitations)) {
    for (const inv of phone.invitations as Record<string, unknown>[]) {
      if (Array.isArray(inv?.actorKeys) && inv.actorKeys.includes(actorKey)) {
        references.push({
          category: 'invitation',
          key: String(inv.key ?? ''),
          label: `日历约定: ${String(inv.title ?? inv.key)}`,
        });
      }
    }
  }

  // Check history facts
  if (Array.isArray(content.history)) {
    for (const fact of content.history as Record<string, unknown>[]) {
      if (Array.isArray(fact?.actorKeys) && fact.actorKeys.includes(actorKey)) {
        references.push({
          category: 'history',
          key: String(fact.key ?? ''),
          label: `已发生事实: ${String(fact.text ?? fact.key).slice(0, 20)}`,
        });
      }
    }
  }

  // Check candidates
  if (Array.isArray(content.candidates)) {
    for (const cand of content.candidates as Record<string, unknown>[]) {
      if (Array.isArray(cand?.actorKeys) && cand.actorKeys.includes(actorKey)) {
        references.push({
          category: 'candidate',
          key: String(cand.key ?? ''),
          label: `剧情节点: ${String(cand.title ?? cand.key)}`,
        });
      }
    }
  }

  // Visibility, intent and extension references also survive deletion; never silently broaden them.
  function inspect(value: unknown, path: string[]) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => inspect(v, [...path, String(i)]));
      return;
    }
    const obj = value as Record<string, unknown>;
    if (
      obj.actorKey === actorKey ||
      (Array.isArray(obj.actorKeys) && obj.actorKeys.includes(actorKey))
    )
      references.push({
        category: 'visibility',
        key: path.join('.'),
        label: '相关人物引用: ' + path.join('.'),
      });
    Object.entries(obj).forEach(([k, v]) => inspect(v, [...path, k]));
  }
  Object.entries(content).forEach(([k, v]) => {
    if (k !== 'actors' && k !== 'initialKnowledge') inspect(v, [k]);
  });

  return {
    canDelete: references.length === 0,
    references,
  };
}

/** Deletes an actor safely from content, cleaning up direct initialKnowledge and isolated relations. */
export function deleteActorFromContent(
  content: Record<string, unknown>,
  actorKey: string,
): Record<string, unknown> {
  if (!checkActorDeletionSafety(content, actorKey).canDelete) throw new Error('ACTOR_REFERENCED');
  const next = deepClone(content);
  if (Array.isArray(next.actors)) {
    next.actors = (next.actors as Record<string, unknown>[]).filter((a) => a?.key !== actorKey);
  }
  if (Array.isArray(next.initialKnowledge)) {
    next.initialKnowledge = (next.initialKnowledge as Record<string, unknown>[]).filter(
      (k) => k?.actorKey !== actorKey,
    );
  }
  if (Array.isArray(next.relationships)) {
    next.relationships = (next.relationships as Record<string, unknown>[]).filter((r) => {
      const from = r?.from as Record<string, unknown> | undefined;
      const to = r?.to as Record<string, unknown> | undefined;
      return from?.actorKey !== actorKey && to?.actorKey !== actorKey;
    });
  }
  return next;
}

/** Parses World Settings form fields from content. */
export function parseWorldSettings(
  content: Record<string, unknown>,
  workTitleFallback = '',
): WorldSettingsForm {
  const work = (content.work && typeof content.work === 'object' ? content.work : {}) as Record<
    string,
    unknown
  >;
  const world = (content.world && typeof content.world === 'object' ? content.world : {}) as Record<
    string,
    unknown
  >;
  const protagonist = (
    content.protagonist && typeof content.protagonist === 'object' ? content.protagonist : {}
  ) as Record<string, unknown>;

  return {
    title: String(work.title ?? world.title ?? workTitleFallback ?? ''),
    hook: String(work.hook ?? world.hook ?? ''),
    description: String(work.description ?? world.description ?? ''),
    experienceNote: String(work.experienceNote ?? world.experienceNote ?? ''),
    coverMediaKey: typeof work.coverMediaKey === 'string' ? work.coverMediaKey : undefined,
    publicSetting: String(world.publicSetting ?? ''),
    tone: String(world.tone ?? ''),
    startAt: String(world.startAt ?? ''),
    startPlaceKey: String(world.startPlaceKey ?? ''),
    hiddenContext: String(world.hiddenContext ?? ''),
    protagonistIdentity: String(protagonist.identity ?? world.protagonistIdentity ?? ''),
    protagonistSituation: String(protagonist.situation ?? world.protagonistSituation ?? ''),
  };
}

/** Updates World Settings into content without losing other fields. */
export function updateWorldSettingsInContent(
  content: Record<string, unknown>,
  settings: WorldSettingsForm,
): Record<string, unknown> {
  const next = deepClone(content);

  const before = parseWorldSettings(content);
  const patch = (section: string, target: string, field: keyof WorldSettingsForm) => {
    if (before[field] === settings[field]) return;
    const object = (
      next[section] && typeof next[section] === 'object' && !Array.isArray(next[section])
        ? next[section]
        : {}
    ) as Record<string, unknown>;
    next[section] = { ...object, [target]: settings[field] };
  };
  for (const field of ['title', 'hook', 'description', 'experienceNote', 'coverMediaKey'] as const)
    patch('work', field, field);
  for (const field of [
    'publicSetting',
    'tone',
    'startAt',
    'startPlaceKey',
    'hiddenContext',
  ] as const)
    patch('world', field, field);
  const legacy = content.world as Record<string, unknown> | undefined;
  for (const field of ['title', 'hook'] as const)
    if (legacy && Object.hasOwn(legacy, field)) patch('world', field, field);
  patch('protagonist', 'identity', 'protagonistIdentity');
  patch('protagonist', 'situation', 'protagonistSituation');

  return next;
}

/** Parses plot candidates and history facts for the Plot tab. */
export function parsePlotData(content: Record<string, unknown>): PlotEditorForm {
  const history: PlotEditorForm['history'] = [];
  if (Array.isArray(content.history)) {
    for (const h of content.history as Record<string, unknown>[]) {
      if (!h || typeof h !== 'object') continue;
      history.push({
        key: String(h.key ?? ''),
        text: String(h.text ?? ''),
        occurredAt: String(h.occurredAt ?? ''),
        actorKeys: Array.isArray(h.actorKeys)
          ? h.actorKeys.filter((k): k is string => typeof k === 'string')
          : [],
      });
    }
  }

  const candidates: CandidateSummary[] = [];
  if (Array.isArray(content.candidates)) {
    for (const c of content.candidates as Record<string, unknown>[]) {
      if (!c || typeof c !== 'object') continue;
      const tl = c.timeline as Record<string, unknown> | undefined;
      candidates.push({
        key: String(c.key ?? ''),
        title: String(c.title ?? ''),
        editorialIntent: String(c.editorialIntent ?? ''),
        actorKeys: Array.isArray(c.actorKeys)
          ? c.actorKeys.filter((k): k is string => typeof k === 'string')
          : [],
        placeKey: typeof c.placeKey === 'string' ? c.placeKey : undefined,
        stageKey: typeof tl?.stageKey === 'string' ? tl.stageKey : undefined,
      });
    }
  }

  return { history, candidates };
}

/** Determines whether the current working draft has unsaved changes compared to the saved state. */
export function isDraftDirty(
  saved: { title: string; content: Record<string, unknown> } | null,
  current: { title: string; content: Record<string, unknown> },
): boolean {
  if (!saved) return false;
  if (saved.title !== current.title) return true;
  return JSON.stringify(saved.content) !== JSON.stringify(current.content);
}
