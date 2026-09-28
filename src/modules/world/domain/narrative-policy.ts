import type { Appointment, Message } from './types.ts';

/** Original, reusable scene directions, not fixed plots or a psychological profile. */
export const NARRATIVE_MOVES = {
  arrival: {
    goal: '承接当前开场事件，让用户看见自己能参与的一小步。',
    instruction:
      '从已有身份和情境取材；只聚焦一个机会或难题，说明与你有关的具体利害。不要另开几条危机，也不要预先替用户成功或失败。',
    maxNewThreads: 1,
  },
  answer: {
    goal: '先解答用户正在问的事。',
    instruction:
      '直接回答；不知道就说明。不能为留悬念扣住角色已知且愿意告知的答案，不用突发事件岔开问题。',
    maxNewThreads: 0,
  },
  negotiate: {
    goal: '把已有约定或条件谈清楚，让用户能作出选择。',
    instruction:
      '说明已有约定中尚未确定的一点与角色自己的限制，允许协商、拒绝或第三种方案；提议不是用户已经接受。不要重复制造已经解决的障碍。',
    maxNewThreads: 0,
  },
  follow_through: {
    goal: '承接角色自己答应过的事。',
    instruction:
      '优先回应有来源的承诺。依据现有记录交代已知进展、能做的下一步或真实限制；没有证据不能声称大事已完成。兑现已有的小回报后再考虑新线索。',
    maxNewThreads: 0,
  },
  appointment_due: {
    goal: '承接已经约好的事，而不是替主角赴约。',
    instruction:
      '约定时间已到。自然询问或说明自己此刻确实知道的安排；不要声称主角到场，也不要替他作决定。',
    maxNewThreads: 0,
  },
  appointment_result: {
    goal: '承接主角亲自记录的赴约结果。',
    instruction:
      '只依据日历里主角自己记录的已赴约或未赴约状态回应，体现你这个人物的态度；没有现场细节就询问，不要虚构发生过的事情或再催同一邀约。',
    maxNewThreads: 0,
  },
  breathing_room: {
    goal: '给这一段生活留出轻松相处或自然收尾的空间。',
    instruction:
      '回应用户的节奏要求或告别。保留角色自己的语气，不新增危机、倒计时或逼问，不用离开就失去关系的说法；无需每次问问题。',
    maxNewThreads: 0,
  },
  continue: {
    goal: '承接已有情境，呈现人物的态度与行动。',
    instruction:
      '先回应，再选择一个有依据的小行动、取舍或温暖细节。人物可以不同意，但要有自身目标和原因。让用户已做的事影响回应，不保证用户要什么就有什么，也不为难而为难。允许本轮没有新悬念。',
    maxNewThreads: 0,
  },
} as const;
export type NarrativeMove = keyof typeof NARRATIVE_MOVES;
export type NarrativeBrief = {
  version: 'narrative-1';
  move: NarrativeMove;
  reason: string;
  evidenceIds: string[];
  goal: string;
  instruction: string;
  maxNewThreads: number;
};
type Input = {
  actorId: string;
  userText: string;
  origin?: 'director';
  messages: readonly Message[];
  appointments: readonly Appointment[];
  time?: string;
  /** Already authorized by the context compiler. */
  memories: readonly {
    id: string;
    kind: string;
    status: string;
    scopeType: string;
    scopeId: string;
    characterId?: string;
  }[];
};

/** Conservative selection from observable inputs; this is not a persistent arc engine. */
export function narrativeBrief(input: Input): NarrativeBrief {
  const text = input.userText.trim();
  const choose = (
    move: NarrativeMove,
    reason: string,
    evidenceIds: string[] = [],
  ): NarrativeBrief => ({
    version: 'narrative-1',
    move,
    reason,
    evidenceIds: evidenceIds.slice(0, 3),
    ...NARRATIVE_MOVES[move],
  });
  if (
    !input.origin &&
    /^(?:今天)?(?:先这样|晚安|再见|我先走了)[。！!\s]*$|(?:我只想|我想|让我|我们先)(?:先|稍微|好好)?(?:休息|歇会|轻松一下)|(?:先别|不要再|别再)(?:加压|催我|推进剧情|安排冲突)|(?:先不|暂时不)(?:推进|聊这件事)/u.test(
      text,
    )
  )
    return choose('breathing_room', '用户明确表达休息、收尾或减压意愿');

  const resultAppointments = input.appointments.filter(
    (a) =>
      a.participantIds.includes(input.actorId) &&
      (a.status === 'attended' || a.status === 'missed'),
  );
  const relevantAppointment = input.origin
    ? resultAppointments.find((a) => text.includes(a.title))
    : resultAppointments.sort((a, b) => (b.responseAt ?? '').localeCompare(a.responseAt ?? ''))[0];
  if (
    relevantAppointment &&
    (input.origin === 'director' || /赴约|没去|见面|活动|约定/u.test(text))
  )
    return choose('appointment_result', '用户已明确记录这次约定的结果', [relevantAppointment.id]);
  const dueAppointments = input.appointments.filter(
    (a) =>
      a.participantIds.includes(input.actorId) &&
      a.status === 'confirmed' &&
      Boolean(input.time) &&
      a.at <= input.time!,
  );
  const dueAppointment = input.origin
    ? dueAppointments.find((a) => text.includes(a.title))
    : dueAppointments.sort((a, b) => b.at.localeCompare(a.at))[0];
  if (dueAppointment && (input.origin === 'director' || /赴约|见面|活动|约定/u.test(text)))
    return choose('appointment_due', '约定时间已到，但未确认是否赴约', [dueAppointment.id]);

  const promises = input.memories.filter(
    (m) =>
      m.status === 'active' &&
      m.kind === 'commitment' &&
      m.scopeType === 'character' &&
      m.scopeId === input.actorId &&
      (!m.characterId || m.characterId === input.actorId),
  );
  if (
    promises.length &&
    (input.origin === 'director' || /答应|说好的|进展|结果|办得怎么样/u.test(text))
  )
    return choose(
      'follow_through',
      '先承接这个角色已有的承诺',
      promises.map((m) => m.id),
    );

  const pending = input.appointments.filter(
    (a) => a.status === 'proposed' && a.participantIds.includes(input.actorId),
  );
  if (
    pending.length &&
    (input.origin === 'director' || /约定|改期|几点|见面|排期|赴约/u.test(text))
  )
    return choose(
      'negotiate',
      '存在尚未确认的约定',
      pending.map((a) => a.id),
    );

  if (!input.origin && /[?？]|为什么|怎么|是什么|在哪里|什么事|能不能|可不可以/u.test(text))
    return choose('answer', '用户提出了需要先回答的问题');
  if (!input.messages.some((m) => m.role === 'user'))
    return choose('arrival', '还没有与这个角色展开过用户对话');
  return choose('continue', '延续已有对话，不强行新增矛盾');
}
