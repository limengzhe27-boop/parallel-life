/**
 * Automatically provides sensible runtime defaults and repairs drafts so that authors
 * are never blocked by schema constraints, missing fields, unrecognized keys,
 * scheduling, or reference checks. Director agents and runtime handle dynamic execution.
 */
export function ensurePublishableDefaults(
  raw: Record<string, unknown>,
  fallbackTitle?: string,
): Record<string, unknown> {
  const content = structuredClone(raw ?? {}) as Record<string, any>;
  content.schemaVersion = 1;

  function safeKey(k: unknown, fallback: string): string {
    if (typeof k !== 'string' || !k.trim()) return fallback;
    const cleaned = k.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 32);
    if (!/^[a-z]/.test(cleaned)) return 'k_' + cleaned.slice(0, 30);
    return cleaned;
  }

  function safeText(t: unknown, maxLen: number, fallback = ''): string {
    if (typeof t !== 'string') return fallback;
    const trimmed = t.trim();
    if (!trimmed) return fallback;
    return trimmed.slice(0, maxLen);
  }

  // 1. Work
  const srcWork = (content.work && typeof content.work === 'object' ? content.work : {}) as Record<string, any>;
  const rawTitle = safeText(fallbackTitle, 80) || safeText(srcWork.title, 80, '未命名故事');
  const workKey = safeKey(srcWork.key, 'work_' + rawTitle.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 10));

  content.work = {
    key: /^[a-z][a-z0-9_]{0,31}$/.test(workKey) ? workKey : 'work_story',
    title: rawTitle,
    hook: safeText(srcWork.hook, 180, rawTitle),
    description: safeText(srcWork.description, 1600, `${rawTitle}：一段充满未知与抉择的平行人生。`),
    experienceNote: safeText(srcWork.experienceNote, 300, '沉浸式平行人生体验'),
  };
  if (typeof srcWork.coverMediaKey === 'string' && srcWork.coverMediaKey) {
    content.work.coverMediaKey = safeKey(srcWork.coverMediaKey, 'cover');
  }

  // 2. World
  const srcWorld = (content.world && typeof content.world === 'object' ? content.world : {}) as Record<string, any>;
  let startAt = typeof srcWorld.startAt === 'string' && srcWorld.startAt.includes('T') ? srcWorld.startAt : '';
  if (!startAt || isNaN(Date.parse(startAt))) {
    startAt = new Date().toISOString();
  }

  content.world = {
    publicSetting: safeText(srcWorld.publicSetting, 1600, `${content.work.title}：一段充满未知与抉择的平行人生。`),
    tone: safeText(srcWorld.tone, 200, '现实质感 · 沉浸探索'),
    startAt,
    startPlaceKey: safeKey(srcWorld.startPlaceKey, 'place_main'),
    hiddenContext: safeText(srcWorld.hiddenContext, 4000, safeText(srcWorld.publicSetting, 1600, `${content.work.title}：一段充满未知与抉择的平行人生。`)),
  };

  // 3. Places
  const rawPlaces = Array.isArray(content.places) ? content.places : [];
  const placesMap = new Map<string, any>();
  rawPlaces.forEach((p: any, idx: number) => {
    if (!p || typeof p !== 'object') return;
    const k = safeKey(p.key, `place_${idx + 1}`);
    if (placesMap.has(k)) return;
    placesMap.set(k, {
      key: k,
      name: safeText(p.name, 100, `地点 ${idx + 1}`),
      description: safeText(p.description, 800, '故事发生的场所之一'),
      knownAtStart: typeof p.knownAtStart === 'boolean' ? p.knownAtStart : true,
    });
  });

  if (placesMap.size === 0) {
    placesMap.set('place_main', {
      key: 'place_main',
      name: '现场',
      description: '故事发生的主场所',
      knownAtStart: true,
    });
  }

  content.places = Array.from(placesMap.values()).slice(0, 24);
  const validPlaceKeys = new Set(content.places.map((p: any) => p.key));
  if (!validPlaceKeys.has(content.world.startPlaceKey)) {
    content.world.startPlaceKey = content.places[0].key;
  }
  // Ensure startPlace is knownAtStart
  const startPlaceObj = content.places.find((p: any) => p.key === content.world.startPlaceKey);
  if (startPlaceObj) startPlaceObj.knownAtStart = true;

  // 4. Protagonist
  const srcProt = (content.protagonist && typeof content.protagonist === 'object' ? content.protagonist : {}) as Record<string, any>;
  content.protagonist = {
    identity: safeText(srcProt.identity, 300, '体验者'),
    situation: safeText(srcProt.situation, 1000, '你来到了这里，故事由此展开。'),
    knownFactKeys: Array.isArray(srcProt.knownFactKeys)
      ? Array.from(new Set(srcProt.knownFactKeys.map((k: any) => safeKey(k, 'fact')).filter(Boolean))).slice(0, 64)
      : [],
  };

  // 5. Actors
  const rawActors = Array.isArray(content.actors) ? content.actors : [];
  const actorsMap = new Map<string, any>();
  rawActors.forEach((a: any, idx: number) => {
    if (!a || typeof a !== 'object') return;
    const k = safeKey(a.key, `actor_${idx + 1}`);
    if (actorsMap.has(k)) return;
    const name = safeText(a.name, 80, `角色 ${idx + 1}`);
    const pubCard = (a.publicCard && typeof a.publicCard === 'object' ? a.publicCard : {}) as Record<string, any>;
    const privPersona = (a.privatePersona && typeof a.privatePersona === 'object' ? a.privatePersona : {}) as Record<string, any>;

    const traits = Array.isArray(pubCard.traits) && pubCard.traits.length > 0
      ? pubCard.traits.map((t: any) => safeText(t, 60, '沉稳')).slice(0, 3)
      : ['沉稳'];

    const actorObj: Record<string, any> = {
      key: k,
      name,
      knownAtStart: typeof a.knownAtStart === 'boolean' ? a.knownAtStart : true,
      publicCard: {
        introduction: safeText(pubCard.introduction, 1600, `${name}的个人介绍。`),
        identity: safeText(pubCard.identity, 160, name),
        traits,
      },
      privatePersona: {
        background: safeText(privPersona.background, 1200, safeText(pubCard.introduction, 1200, `${name}的背景与经历。`)),
        motivation: safeText(privPersona.motivation, 600, '体验生活并探寻内心所想。'),
        voice: safeText(privPersona.voice, 600, '自然生动，日常口吻。'),
        boundaries: safeText(privPersona.boundaries, 600, '遵循道德常理。'),
      },
    };

    if (pubCard.appearance) {
      actorObj.publicCard.appearance = safeText(pubCard.appearance, 240);
    }
    if (pubCard.avatarMediaKey) {
      actorObj.publicCard.avatarMediaKey = safeKey(pubCard.avatarMediaKey, 'avatar');
    }

    if (a.lifeModules && typeof a.lifeModules === 'object') {
      const lm = a.lifeModules;
      const lifeModules: Record<string, any> = {};
      if (lm.lifeContext) lifeModules.lifeContext = safeText(lm.lifeContext, 4000);
      if (lm.traits) lifeModules.traits = safeText(lm.traits, 4000);
      if (lm.drives) lifeModules.drives = safeText(lm.drives, 4000);
      if (lm.behavior) lifeModules.behavior = safeText(lm.behavior, 4000);
      if (lm.relationships) lifeModules.relationships = safeText(lm.relationships, 4000);
      if (Object.keys(lifeModules).length > 0) {
        actorObj.lifeModules = lifeModules;
      }
    }

    actorsMap.set(k, actorObj);
  });

  if (actorsMap.size === 0) {
    actorsMap.set('actor_guide', {
      key: 'actor_guide',
      name: '同行者',
      knownAtStart: true,
      publicCard: {
        introduction: '一位与你同行的朋友。',
        identity: '同行者',
        traits: ['沉稳'],
      },
      privatePersona: {
        background: '一位与你同行的朋友。',
        motivation: '探索故事中的可能性。',
        voice: '平和自然。',
        boundaries: '遵循道德常理。',
      },
    });
  }

  content.actors = Array.from(actorsMap.values()).slice(0, 12);
  const validActorKeys = new Set(content.actors.map((a: any) => a.key));
  const defaultActorKey = content.actors[0].key;

  // 6. Relationships
  const relMap = new Map<string, any>();
  const rawRels = Array.isArray(content.relationships) ? content.relationships : [];
  rawRels.forEach((r: any, idx: number) => {
    if (!r || typeof r !== 'object') return;
    const k = safeKey(r.key, `rel_${idx + 1}`);
    if (relMap.has(k)) return;
    const fromKind = r.from?.kind === 'actor' ? 'actor' : 'player';
    const fromKey = fromKind === 'actor' ? (validActorKeys.has(r.from?.actorKey) ? r.from.actorKey : defaultActorKey) : undefined;
    const toKind = r.to?.kind === 'player' ? 'player' : 'actor';
    const toKey = toKind === 'actor' ? (validActorKeys.has(r.to?.actorKey) ? r.to.actorKey : defaultActorKey) : undefined;

    // Avoid self relationship
    if ((fromKind === 'player' && toKind === 'player') || (fromKind === 'actor' && toKind === 'actor' && fromKey === toKey)) {
      return;
    }

    relMap.set(k, {
      key: k,
      from: fromKind === 'actor' ? { kind: 'actor', actorKey: fromKey } : { kind: 'player' },
      to: toKind === 'actor' ? { kind: 'actor', actorKey: toKey } : { kind: 'player' },
      description: safeText(r.description, 400, '相识相知'),
      visibility: r.visibility?.kind === 'player' ? { kind: 'player' } : { kind: 'world' },
    });
  });
  content.relationships = Array.from(relMap.values()).slice(0, 64);

  // 7. Routes
  const routeMap = new Map<string, any>();
  const rawRoutes = Array.isArray(content.routes) ? content.routes : [];
  rawRoutes.forEach((rt: any) => {
    if (!rt || typeof rt !== 'object') return;
    const from = validPlaceKeys.has(rt.fromPlaceKey) ? rt.fromPlaceKey : content.world.startPlaceKey;
    const to = validPlaceKeys.has(rt.toPlaceKey) ? rt.toPlaceKey : content.world.startPlaceKey;
    if (from === to) return;
    const pair = `${from}:${to}`;
    if (routeMap.has(pair)) return;
    routeMap.set(pair, {
      fromPlaceKey: from,
      toPlaceKey: to,
      minutes: typeof rt.minutes === 'number' && rt.minutes >= 1 && rt.minutes <= 1440 ? Math.floor(rt.minutes) : 10,
    });
  });
  content.routes = Array.from(routeMap.values()).slice(0, 64);

  // 8. History
  const rawHistory = Array.isArray(content.history) ? content.history : [];
  const histMap = new Map<string, any>();
  rawHistory.forEach((h: any, idx: number) => {
    if (!h || typeof h !== 'object') return;
    const k = safeKey(h.key, `fact_${idx + 1}`);
    if (histMap.has(k)) return;
    const hActors = Array.isArray(h.actorKeys)
      ? Array.from(new Set(h.actorKeys.filter((ak: any) => validActorKeys.has(ak)))).slice(0, 12)
      : [];
    let occurredAt = typeof h.occurredAt === 'string' && !isNaN(Date.parse(h.occurredAt)) ? h.occurredAt : content.world.startAt;
    if (Date.parse(occurredAt) > Date.parse(content.world.startAt)) {
      occurredAt = content.world.startAt;
    }
    const factObj: Record<string, any> = {
      key: k,
      kind: 'established_fact',
      text: safeText(h.text, 1000, '既定背景事实'),
      occurredAt,
      actorKeys: hActors,
      visibility: h.visibility?.kind === 'player' ? { kind: 'player' } : { kind: 'world' },
    };
    if (h.placeKey && validPlaceKeys.has(h.placeKey)) {
      factObj.placeKey = h.placeKey;
    }
    histMap.set(k, factObj);
  });
  content.history = Array.from(histMap.values()).slice(0, 64);
  const validFactKeys = new Set(content.history.map((f: any) => f.key));

  // Filter protagonist known facts to valid facts
  content.protagonist.knownFactKeys = content.protagonist.knownFactKeys.filter((fk: string) => validFactKeys.has(fk));

  // 9. Initial Knowledge
  const rawIK = Array.isArray(content.initialKnowledge) ? content.initialKnowledge : [];
  const ikMap = new Map<string, any>();
  rawIK.forEach((ik: any) => {
    if (!ik || typeof ik !== 'object') return;
    if (!validActorKeys.has(ik.actorKey)) return;
    if (ikMap.has(ik.actorKey)) return;
    const fks = Array.isArray(ik.factKeys)
      ? Array.from(new Set(ik.factKeys.filter((fk: any) => validFactKeys.has(fk)))).slice(0, 64)
      : [];
    ikMap.set(ik.actorKey, { actorKey: ik.actorKey, factKeys: fks });
  });
  content.initialKnowledge = Array.from(ikMap.values()).slice(0, 12);

  // 10. Phone
  const rawPhone = (content.phone && typeof content.phone === 'object' ? content.phone : {}) as Record<string, any>;
  const rawMsgs = Array.isArray(rawPhone.messages) ? rawPhone.messages : [];
  const msgMap = new Map<string, any>();
  const startTime = Date.parse(content.world.startAt);

  rawMsgs.forEach((m: any, idx: number) => {
    if (!m || typeof m !== 'object') return;
    const k = safeKey(m.key, `msg_${idx + 1}`);
    if (msgMap.has(k)) return;
    const actorKey = validActorKeys.has(m.actorKey) ? m.actorKey : defaultActorKey;
    // Sender must be knownAtStart
    const sender = actorsMap.get(actorKey);
    if (sender) sender.knownAtStart = true;

    const speaker = m.speaker === 'player' ? 'player' : 'actor';
    // If player speaks, origin must be history
    const origin = speaker === 'player' ? 'history' : (m.origin === 'incoming' ? 'incoming' : 'history');

    let atTime = typeof m.at === 'string' && !isNaN(Date.parse(m.at)) ? Date.parse(m.at) : 0;
    if (origin === 'history') {
      // Must be strictly before world start
      if (atTime >= startTime || atTime === 0) {
        atTime = startTime - (rawMsgs.length - idx) * 3600000;
      }
    } else {
      // Incoming message cannot be in the future of world start
      if (atTime > startTime || atTime === 0) {
        atTime = startTime;
      }
    }

    msgMap.set(k, {
      key: k,
      actorKey,
      origin,
      speaker,
      text: safeText(m.text, 500, '你好'),
      at: new Date(atTime).toISOString(),
    });
  });

  const rawMoments = Array.isArray(rawPhone.moments) ? rawPhone.moments : [];
  const momMap = new Map<string, any>();
  rawMoments.forEach((mom: any, idx: number) => {
    if (!mom || typeof mom !== 'object') return;
    const k = safeKey(mom.key, `mom_${idx + 1}`);
    if (momMap.has(k)) return;
    const actorKey = validActorKeys.has(mom.actorKey) ? mom.actorKey : defaultActorKey;
    const sender = actorsMap.get(actorKey);
    if (sender) sender.knownAtStart = true;

    let atTime = typeof mom.at === 'string' && !isNaN(Date.parse(mom.at)) ? Date.parse(mom.at) : 0;
    if (atTime > startTime || atTime === 0) {
      atTime = startTime - (rawMoments.length - idx) * 7200000;
    }

    momMap.set(k, {
      key: k,
      actorKey,
      text: safeText(mom.text, 1600, '美好的一天'),
      at: new Date(atTime).toISOString(),
    });
  });

  content.phone = {
    messages: Array.from(msgMap.values()).slice(0, 40),
    moments: Array.from(momMap.values()).slice(0, 48),
    notes: [],
    invitations: [],
    album: [],
  };

  // Re-sync actors array with updated knownAtStart
  content.actors = Array.from(actorsMap.values()).slice(0, 12);

  // 11. Media, Candidates, Extensions
  content.media = Array.isArray(content.media) ? content.media : [];
  content.candidates = Array.isArray(content.candidates) ? content.candidates : [];
  content.extensions = Array.isArray(content.extensions) ? content.extensions : [];

  const result: Record<string, any> = {
    schemaVersion: 1,
    work: content.work,
    world: content.world,
    protagonist: content.protagonist,
    actors: content.actors,
    relationships: content.relationships,
    places: content.places,
    routes: content.routes,
    history: content.history,
    initialKnowledge: content.initialKnowledge,
    phone: content.phone,
    media: content.media,
    candidates: content.candidates,
    extensions: content.extensions,
  };
  if (content.openingEventKey && validActorKeys.has(content.openingEventKey)) {
    result.openingEventKey = content.openingEventKey;
  }
  return result;
}
