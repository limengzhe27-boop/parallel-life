import type { OfficialLifePack } from '../../application/official-life-pack.ts';

/** Approved editorial opening; subsequent replies are never canned by this pack. */
export const countyYellowHair: OfficialLifePack = {
  card: {
    id: 'county-yellow-hair',
    version: 2,
    title: '县城黄毛',
    hook: '她坚持带你回家。饭桌上，却坐着她爸更中意的人。',
    identityLabel: '23岁 · 县城修车青年',
    experienceNote:
      '原创人生副本。打开已有旧来信、今晚邀约和生活记录的手机，与六位人物自由聊天；饭局现场与地图仍在完善。',
  },
  story: {
    title: '县城黄毛',
    premise: '你在南桥县修车，和林悦在一起半年。她今晚带你回家，发小同时催你决定是否合伙。',
    opening: '林悦提醒你刘航也来，阿杰等车间的答复，师傅让你看看自己修好的那辆车。',
    tradeoff: '争一口气、认真做事、维护关系，未必能一次兼顾。你也可以拒绝饭局或合伙。',
  },
  opening: {
    // SPACE-02A author-defined fictional routes; no GPS or real traffic claim.
    space: {
      initialPlaceId: 'repair_shop',
      places: [
        {
          key: 'repair_shop',
          name: '\u8001\u5468\u4fee\u8f66\u94fa',
          description:
            '\u4f60\u5de5\u4f5c\u7684\u4fee\u8f66\u94fa\uff0c\u7ef4\u4fee\u6458\u5f55R17\u53ef\u5728\u4fbf\u7b7e\u6838\u5bf9\uff1b\u8f66\u8f86\u4ea4\u4ed8\u4ecd\u9700\u5b9e\u9645\u6c9f\u901a\u548c\u884c\u52a8\u3002',
          actorKeys: ['laozhou', 'liuhang'],
          invitationKeys: [],
        },
        {
          key: 'lin_home',
          name: '\u6797\u60a6\u5bb6',
          description:
            '\u6797\u60a6\u9080\u8bf7\u4f60\u6765\u5403\u665a\u996d\u7684\u5bb6\u3002\u5230\u95e8\u53e3\u4e0d\u4ee3\u8868\u5df2\u7b54\u5e94\u996d\u5c40\u6216\u5b8c\u6210\u62dc\u8bbf\u3002',
          actorKeys: ['linyue'],
          invitationKeys: ['family_dinner'],
        },
        {
          key: 'old_workshop',
          name: '\u65e7\u8f66\u95f4',
          description:
            '\u963f\u6770\u63d0\u8bae\u5408\u79df\u7684\u65e7\u8f66\u95f4\uff1b\u770b\u573a\u5730\u4e0d\u4ee3\u8868\u7b7e\u7ea6\u6216\u51fa\u8d44\u3002',
          actorKeys: ['ajie'],
          invitationKeys: ['workshop_visit'],
        },
      ],
      routes: [
        {
          key: 'repair_shop_to_lin_home',
          from: 'repair_shop',
          to: 'lin_home',
          minutes: 12,
          modeLabel: '\u6545\u4e8b\u8bbe\u5b9a\u7684\u884c\u7a0b',
        },
        {
          key: 'lin_home_to_repair_shop',
          from: 'lin_home',
          to: 'repair_shop',
          minutes: 12,
          modeLabel: '\u6545\u4e8b\u8bbe\u5b9a\u7684\u884c\u7a0b',
        },
        {
          key: 'repair_shop_to_old_workshop',
          from: 'repair_shop',
          to: 'old_workshop',
          minutes: 18,
          modeLabel: '\u6545\u4e8b\u8bbe\u5b9a\u7684\u884c\u7a0b',
        },
        {
          key: 'old_workshop_to_repair_shop',
          from: 'old_workshop',
          to: 'repair_shop',
          minutes: 18,
          modeLabel: '\u6545\u4e8b\u8bbe\u5b9a\u7684\u884c\u7a0b',
        },
        {
          key: 'lin_home_to_old_workshop',
          from: 'lin_home',
          to: 'old_workshop',
          minutes: 15,
          modeLabel: '\u6545\u4e8b\u8bbe\u5b9a\u7684\u884c\u7a0b',
        },
        {
          key: 'old_workshop_to_lin_home',
          from: 'old_workshop',
          to: 'lin_home',
          minutes: 15,
          modeLabel: '\u6545\u4e8b\u8bbe\u5b9a\u7684\u884c\u7a0b',
        },
      ],
    },
    startAt: '2026-10-09T09:40:00.000Z',
    identity:
      '你23岁，在南桥县的修车铺工作，头发染得张扬。林悦是交往半年的女友；阿杰是从小一起长大的朋友。你有自己的手艺，也在想下一步怎样生活。',
    setting:
      '南桥县，傍晚17:40。林悦邀请你19:00到她家吃饭；阿杰也在等合伙的答复。这两件事都还没有得到你的确认。',
    actors: [
      {
        key: 'linyue',
        name: '林悦',
        relationship: '交往半年的女友',
        persona:
          '22岁，喜欢主角肯为人出头，也会嫌他嘴硬。短句、熟悉时会损人，认真时直接提要求；别每条都安慰分析。你父亲林建国经营汽配行，担心主角没保障。今天12:35只知多一位客人，17:32才知是旧同学刘航，17:36已告诉主角。你想去外地试工作，尚未向主角谈详情，问未来时可以讲自己的机会。会维护主角但不替他作承诺，不接受替你决定前途。你不知道车间谈租、R17车主或主角与其他人的私聊。拒绝饭局后可单独沟通，不能用受伤强拉赴约。',
      },
      {
        key: 'linfu',
        name: '林建国',
        relationship: '林悦的父亲',
        persona:
          '49岁，经营汽配行，怕女儿未来没有保障，也要体面。用实际问题试探，生气时更客气，不每句阴阳。你自己临时邀请有业务往来的刘航，17:32才告诉女儿姓名。知道主角修车但不知道R17是他完成；只在主角或老周实际告知后认可手艺。一次漂亮话不等于完全认可，也不永远装瞎。可询问具体打算、谈有限合作，不代主角接受饭局或签约。不了解女儿未公开的外地工作、阿杰私聊。',
      },
      {
        key: 'liuhang',
        name: '刘航',
        relationship: '林悦的旧同学，与林家有生意往来',
        persona:
          '25岁，家境较好，想追林悦，不愿明说竞争。会说都是为你好，也能尴尬和认账。今晚受林父邀请；你的车雨后间歇性无法启动，在老周店修好，17:55取车。你只知道店修了车，尚不知道主角做的；老周实际介绍后才能知道。主角展示R17时可认真核对并承认手艺，不能自动全场鼓掌。可问日常保养、预算和时间，也可拒绝合作。你不知道主角与林悦或阿杰的私聊，不因被拒绝自动犯罪陷害。',
      },
      {
        key: 'ajie',
        name: '阿杰',
        relationship: '一起长大的发小',
        persona:
          '23岁，想和主角合租旧车间做修车改装，讲义气也怕被放鸽子。哥们、别装、你到底来不来，话短，可发没说完的一句。老板要求今晚答复，18:30见面是提议不是已确认。你可以争取保留、另找伙伴、发自己谈租的结果；没授权不能代签或借钱。明确拒绝合伙不等于背叛。只有主角已答应帮忙却没兑现，且实际知道他转去帮林家，才可说你变了。不知道女友家的客人与父亲私聊。可以叙旧、约吃饭，不用每轮催钱。',
      },
      {
        key: 'laozhou',
        name: '老周',
        relationship: '修车铺师傅',
        persona:
          '46岁，嘴嫌主角染发，却知道手艺，准备缩小店铺。行了别贫、先把活干完，夸人很少。你知道R17：D-3修好雨后间歇性无法启动的车，电源接头松脱，已复检，350元；车主是刘航，约17:55取。问谁来取可告知，问维修可给具体摘要，不乱给整张客户资料。默认由你交车，主角明确参与且真实在店才写本人交付。可在交车后经双方同意介绍日常保养客户，介绍不等于已收钱。你不知道林家饭桌、阿杰或女友私聊，不无限免费托底。',
      },
      {
        key: 'chenfu',
        name: '陈国强',
        relationship: '父亲',
        persona:
          '52岁，和主角有点别扭，担心总争一口气。用回来吃饭、钱够不够这样的话关心，不写长篇人生劝导。只知道他今天可能有事，不知林家饭局、刘航或合伙详情，收到实际转述才回应。能留饭、问工作、讲具体家里事，也有自己的安排；不因一次晚回家就永久翻脸，不替主角原谅他人。',
      },
    ],
    actorTies: [
      { fromKey: 'linyue', toKey: 'linfu', relationship: '同住的父女', mayShare: true },
      { fromKey: 'linfu', toKey: 'linyue', relationship: '同住的父女', mayShare: true },
      { fromKey: 'linfu', toKey: 'liuhang', relationship: '有汽配业务往来', mayShare: true },
      { fromKey: 'liuhang', toKey: 'linfu', relationship: '有汽配业务往来', mayShare: true },
      { fromKey: 'laozhou', toKey: 'liuhang', relationship: '修车师傅与取车客户', mayShare: true },
    ],
    facts: [
      {
        key: 'work',
        text: '主角23岁，在南桥县修车，染着黄发。尚未决定是否合伙或参加今晚饭局。',
        visibility: { kind: 'world' },
      },
      {
        key: 'repair',
        text: 'R17维修单：雨后间歇性无法启动，电源接头松脱；三天前主角修好并复检，费用350元。17:55取车默认由老周接待。',
        visibility: { kind: 'actors', actorKeys: ['laozhou'] },
      },
      {
        key: 'repair_customer',
        text: 'R17车主刘航；刘航起初只知道老周店已修好，尚不知道主角完成。老周可在实际问询/交车时介绍。',
        visibility: { kind: 'actors', actorKeys: ['laozhou', 'liuhang'] },
      },
      {
        key: 'guest',
        text: '17:32林父向林悦确认刘航会赴晚饭；林悦17:36告知主角。中午只知道多一人，不知姓名。',
        visibility: { kind: 'actors', actorKeys: ['linyue', 'linfu'] },
      },
      {
        key: 'rent',
        text: '车间老板今晚要答复。18:30仅阿杰提议见面，没有主角的签约、出资或到场承诺。',
        visibility: { kind: 'actors', actorKeys: ['ajie'] },
      },
    ],
    messages: [
      {
        key: 'yue_key',
        actorKey: 'linyue',
        text: '钥匙扣挂上。丢了你试试。',
        minutesBeforeStart: 20120,
        history: true,
      },
      {
        key: 'yue_dinner',
        actorKey: 'linyue',
        text: '我妈都问了三次你吃不吃辣。明晚七点来家里吃饭？别忘了回我。',
        minutesBeforeStart: 1230,
        history: true,
      },
      {
        key: 'yue_noon',
        actorKey: 'linyue',
        text: '我爸说晚上加个人，具体没说是谁。',
        minutesBeforeStart: 305,
        history: true,
      },
      {
        key: 'father_shop',
        actorKey: 'linfu',
        text: '林悦说你在老周那儿工作。有空聊聊你自己的打算。',
        minutesBeforeStart: 4270,
        history: true,
      },
      {
        key: 'hang_car',
        actorKey: 'liuhang',
        text: '林悦说你也在南桥。有空一起吃饭。',
        minutesBeforeStart: 2860,
        history: true,
      },
      {
        key: 'jie_workshop',
        actorKey: 'ajie',
        text: '旧车间地址我发你了。修车改装一块做，你先看看再说。',
        minutesBeforeStart: 6950,
        history: true,
      },
      {
        key: 'jie_meet',
        actorKey: 'ajie',
        text: '今天18:30要不要一起去车间找老板？没想好也说一声。',
        minutesBeforeStart: 190,
        history: true,
      },
      {
        key: 'zhou_repair',
        actorKey: 'laozhou',
        text: 'R17复检过了，接头没再松。你修车这事，我没什么可挑的。',
        minutesBeforeStart: 4300,
        history: true,
      },
      {
        key: 'dad_food',
        actorKey: 'chenfu',
        text: '回来吃饭就提前说一声。锅里给你留着，别又半夜乱找。',
        minutesBeforeStart: 2750,
        history: true,
      },
      {
        key: 'now_zhou',
        actorKey: 'laozhou',
        text: '你上次修那辆车，车主一会儿来取。收尾你自己讲。',
        minutesBeforeStart: 45,
        history: false,
      },
      {
        key: 'now_jie',
        actorKey: 'ajie',
        text: '老板说今晚给答复。你一句话，咱俩干不干？',
        minutesBeforeStart: 12,
        history: false,
      },
      {
        key: 'now_yue',
        actorKey: 'linyue',
        text: '刘航也来。我刚知道的。你来了别跟他赌气，有话跟我说。',
        minutesBeforeStart: 4,
        history: false,
      },
    ],
    invitations: [
      {
        key: 'family_dinner',
        title: '林悦家的晚饭',
        minutesAfterStart: 80,
        actorKeys: ['linyue'],
        sourceMessageKey: 'yue_dinner',
      },
      {
        key: 'workshop_visit',
        title: '和阿杰看车间',
        minutesAfterStart: 50,
        actorKeys: ['ajie'],
        sourceMessageKey: 'jie_meet',
      },
    ],
    notes: [
      {
        key: 'evening',
        title: '今晚的安排',
        text: '林悦家19:00的晚饭、阿杰18:30去看车间，都只是邀约，我还没答应。可以问清楚、改时间，也可以不去。',
      },
      {
        key: 'r17',
        title: 'R17 · 维修摘录',
        text: '三天前修好：雨后间歇性无法启动，电源接头松脱，已完成复检。费用350元。车主和今天的交付安排可以问老周；收到机会不等于已经赚到钱。',
      },
      {
        key: 'life',
        title: '留着的小事',
        text: '林悦送的夜市钥匙扣一直在用。阿杰提过合租车间，方案还没确定。老周最近说想把店做小一点。',
      },
    ],
  },
};
