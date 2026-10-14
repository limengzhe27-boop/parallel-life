/**
 * Automatically provides sensible runtime defaults for story drafts so that authors
 * are not blocked by synthetic scheduling, address, protagonist, or place requirements.
 * Director agents and runtime handle dynamic time and spatial coordination.
 */
export function ensurePublishableDefaults(
  raw: Record<string, unknown>,
  title?: string,
): Record<string, unknown> {
  const content = structuredClone(raw ?? {}) as Record<string, any>;
  content.schemaVersion = 1;

  // 1. Work defaults
  content.work = content.work ?? {};
  if (!content.work.key || typeof content.work.key !== 'string') {
    content.work.key = 'work_' + (title ? title.slice(0, 10).toLowerCase().replace(/[^a-z0-9_]/g, '_') : 'main');
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(content.work.key)) {
      content.work.key = 'work_story';
    }
  }
  const storyTitle = typeof title === 'string' && title.trim() ? title.trim() : (typeof content.work.title === 'string' && content.work.title.trim() ? content.work.title.trim() : '未命名故事');
  content.work.title = storyTitle.slice(0, 80);
  if (!content.work.hook || !String(content.work.hook).trim()) content.work.hook = content.work.title.slice(0, 180);
  if (!content.work.experienceNote || !String(content.work.experienceNote).trim()) content.work.experienceNote = '沉浸式平行人生体验';

  // 2. World defaults
  content.world = content.world ?? {};
  if (!content.world.startAt || typeof content.world.startAt !== 'string' || !content.world.startAt.includes('T')) {
    content.world.startAt = new Date().toISOString();
  }
  if (!content.world.publicSetting || !String(content.world.publicSetting).trim()) {
    content.world.publicSetting = `${content.work.title}：一段充满未知与抉择的平行人生。`;
  }
  if (!content.world.tone || !String(content.world.tone).trim()) {
    content.world.tone = '现实质感 · 沉浸探索';
  }
  if (!content.world.hiddenContext || !String(content.world.hiddenContext).trim()) {
    content.world.hiddenContext = content.world.publicSetting;
  }
  if (!content.work.description || !String(content.work.description).trim()) {
    content.work.description = String(content.world.publicSetting).slice(0, 1600);
  }

  // 3. Places defaults
  if (!Array.isArray(content.places) || content.places.length === 0) {
    content.places = [
      {
        key: 'place_main',
        name: '现场',
        description: '故事发生的主场所',
        knownAtStart: true,
      },
    ];
  }
  if (!content.world.startPlaceKey || typeof content.world.startPlaceKey !== 'string') {
    content.world.startPlaceKey = content.places[0]?.key || 'place_main';
  }

  // 4. Protagonist defaults
  content.protagonist = content.protagonist ?? {};
  if (!content.protagonist.identity || !String(content.protagonist.identity).trim()) {
    content.protagonist.identity = '体验者';
  }
  if (!content.protagonist.situation || !String(content.protagonist.situation).trim()) {
    content.protagonist.situation = '你来到了这里，故事由此展开。';
  }
  if (!Array.isArray(content.protagonist.knownFactKeys)) {
    content.protagonist.knownFactKeys = [];
  }

  // 5. Actors defaults
  if (!Array.isArray(content.actors) || content.actors.length === 0) {
    content.actors = [
      {
        key: 'actor_guide',
        name: '同行者',
        knownAtStart: true,
        publicCard: {
          identity: '同行者',
          traits: ['沉稳'],
        },
        privatePersona: {
          background: '一位与你同行的朋友。',
          motivation: '探索故事中的可能性。',
          voice: '平和自然。',
          boundaries: '遵守道德常理。',
        },
      },
    ];
  } else {
    content.actors.forEach((actor: any, idx: number) => {
      if (!actor.key || typeof actor.key !== 'string') actor.key = `actor_${idx + 1}`;
      if (!actor.name || !String(actor.name).trim()) actor.name = `角色 ${idx + 1}`;
      if (typeof actor.knownAtStart !== 'boolean') actor.knownAtStart = true;
      actor.publicCard = actor.publicCard ?? {};
      if (!actor.publicCard.identity) actor.publicCard.identity = actor.name;
      if (!Array.isArray(actor.publicCard.traits) || actor.publicCard.traits.length === 0) {
        actor.publicCard.traits = ['沉稳'];
      }
      actor.privatePersona = actor.privatePersona ?? {};
      if (!actor.privatePersona.background) {
        actor.privatePersona.background = actor.publicCard.introduction || `${actor.name}的个人经历与性格背景。`;
      }
      if (!actor.privatePersona.motivation) {
        actor.privatePersona.motivation = '体验生活并探寻内心所想。';
      }
      if (!actor.privatePersona.voice) {
        actor.privatePersona.voice = '自然生动，日常口吻。';
      }
      if (!actor.privatePersona.boundaries) {
        actor.privatePersona.boundaries = '遵循道德常理。';
      }
    });
  }

  // 6. Sub-collections defaults
  content.relationships = Array.isArray(content.relationships) ? content.relationships : [];
  content.routes = Array.isArray(content.routes) ? content.routes : [];
  content.history = Array.isArray(content.history) ? content.history : [];
  content.initialKnowledge = Array.isArray(content.initialKnowledge) ? content.initialKnowledge : [];
  content.phone = content.phone ?? { messages: [], notes: [], invitations: [], album: [] };
  if (!Array.isArray(content.phone.messages)) content.phone.messages = [];
  content.phone.messages.forEach((msg: any) => {
    if (!msg.at) msg.at = content.world.startAt;
  });
  if (Array.isArray(content.phone.moments)) {
    content.phone.moments.forEach((mom: any) => {
      if (!mom.at) mom.at = content.world.startAt;
    });
  }
  if (Array.isArray(content.candidates)) {
    content.candidates.forEach((cand: any) => {
      if (cand.intent && cand.intent.kind === 'offer_invitation') {
        if (!cand.intent.placeKey) cand.intent.placeKey = content.world.startPlaceKey;
        if (!cand.intent.earliestAt) cand.intent.earliestAt = content.world.startAt;
      }
    });
  }
  content.media = Array.isArray(content.media) ? content.media : [];
  content.candidates = Array.isArray(content.candidates) ? content.candidates : [];
  content.extensions = Array.isArray(content.extensions) ? content.extensions : [];

  return content;
}
