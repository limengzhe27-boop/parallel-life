export function settingContent() {
  return {
    schemaVersion: 1,
    kind: 'original',
    inspiration: null,
    story: {
      title: '第一次独立执导',
      premise: '你正筹备一部短片，需要决定如何使用有限的拍摄预算。',
      opening: '制片人发来两个场地方案，摄影指导希望先讨论光线。',
      tradeoff: '更好的场地意味着更少的排练时间。',
    },
    setup: { identity: '独立导演', place: '虚构海边城市', tone: '温暖、务实，有创作分歧' },
    protagonist: { desire: '拍出自己的第一部短片', dilemma: '预算和创作标准都不能忽略' },
    characters: [
      { id: 'producer', name: '小林', role: '制片人', desire: '按期完成拍摄', voice: '直白、简短' },
      {
        id: 'camera',
        name: '阿周',
        role: '摄影指导',
        desire: '保住画面质感',
        voice: '具体，有幽默感',
      },
    ],
    relationships: [
      {
        fromId: 'producer',
        toId: 'camera',
        context: '长期合作但常有分歧',
        disclosure: 'case_by_case',
      },
    ],
    threads: [
      {
        id: 'location',
        question: '在哪里拍第一场戏？',
        stakes: '预算、时间与信任',
        entryCue: '第一次讨论场地时',
        involvedCharacterIds: ['producer', 'camera'],
        possibleOutcomes: ['找到双方愿意尝试的方案', '暂缓决定并寻找新的场地'],
      },
    ],
    openingCharacterId: 'producer',
    openingThreadId: 'location',
    sources: [],
    contextNotes: [],
  };
}
