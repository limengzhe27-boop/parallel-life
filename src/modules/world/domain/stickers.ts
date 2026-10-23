/** Shared static catalogue; no runtime preference or emotion state. */
export const STICKER_CATALOG = [
  {
    id: 'wole',
    label: '我裂开了',
    src: '/stickers/wole.svg',
    description: '夸张崩溃或自嘲，不表示真实受伤',
  },
  {
    id: 'xswl',
    label: '笑死我了',
    src: '/stickers/xswl.svg',
    description: '大笑或熟人玩笑；严肃难过时可能冒犯',
  },
  {
    id: 'wuyu',
    label: '无语',
    src: '/stickers/wuyu.svg',
    description: '无奈或不赞同',
  },
  {
    id: 'zhende',
    label: '真的假的',
    src: '/stickers/zhende.svg',
    description: '惊讶、怀疑，希望确认',
  },
  {
    id: 'jiuzhe',
    label: '就这？',
    src: '/stickers/jiuzhe.svg',
    description: '轻微挑衅或熟人调侃，可能冒犯',
  },
  {
    id: 'bailan',
    label: '摆烂',
    src: '/stickers/bailan.svg',
    description: '疲惫、自嘲不想努力',
  },
  {
    id: 'chong',
    label: '冲！',
    src: '/stickers/chong.svg',
    description: '兴奋鼓劲，不等于已行动',
  },
  {
    id: 'zaima',
    label: '在吗',
    src: '/stickers/zaima.svg',
    description: '试探联系，不代替具体事情',
  },
  {
    id: 'shuile',
    label: '睡了',
    src: '/stickers/shuile.svg',
    description: '准备休息，不证明已睡着',
  },
  {
    id: 'e',
    label: '饿了',
    src: '/stickers/e.svg',
    description: '饥饿或想吃东西',
  },
  {
    id: 'kun',
    label: '困',
    src: '/stickers/kun.svg',
    description: '困倦、想休息',
  },
  {
    id: 'moyu',
    label: '摸鱼中',
    src: '/stickers/moyu.svg',
    description: '工作间隙放松或自嘲',
  },
  {
    id: 'jiayou',
    label: '加油',
    src: '/stickers/jiayou.svg',
    description: '鼓励、支持对方',
  },
  {
    id: 'keyi',
    label: '可以',
    src: '/stickers/keyi.svg',
    description: '认可可行，不代替正式承诺',
  },
  {
    id: 'juele',
    label: '绝了',
    src: '/stickers/juele.svg',
    description: '赞叹或夸张感慨',
  },
  {
    id: 'hao',
    label: '好',
    src: '/stickers/hao.svg',
    description: '简短应答，不替代明确选择',
  },
  {
    id: 'zan',
    label: '赞',
    src: '/stickers/zan.svg',
    description: '欣赏、称赞',
  },
  {
    id: 'a',
    label: '啊？',
    src: '/stickers/a.svg',
    description: '惊讶或没理解',
  },
  {
    id: 'bie',
    label: '别',
    src: '/stickers/bie.svg',
    description: '制止或拒绝，认真程度取决于语境',
  },
  {
    id: 'wanan',
    label: '晚安',
    src: '/stickers/wanan.svg',
    description: '温和道别',
  },
] as const;
export const STICKER_IDS = [
  'wole',
  'xswl',
  'wuyu',
  'zhende',
  'jiuzhe',
  'bailan',
  'chong',
  'zaima',
  'shuile',
  'e',
  'kun',
  'moyu',
  'jiayou',
  'keyi',
  'juele',
  'hao',
  'zan',
  'a',
  'bie',
  'wanan',
] as const;
export type StickerId = (typeof STICKER_IDS)[number];
export function isStickerId(value: unknown): value is StickerId {
  return typeof value === 'string' && (STICKER_IDS as readonly string[]).includes(value);
}

/** The sendable subset can shrink without breaking historical IDs. */
export const SELECTABLE_STICKERS = STICKER_CATALOG;
export function getSticker(id: string) {
  return STICKER_CATALOG.find((s) => s.id === id) ?? null;
}
