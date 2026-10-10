import type { OfficialLifePack } from '../../application/official-life-pack.ts';

export const retiredStar: OfficialLifePack = {
  card: {
    id: 'retired-star',
    version: 2,
    title: '退圈后的顶流',
    hook: '你说不回来了。今晚所有人，又在等你出现。',
    identityLabel: '28岁 · 搬到海边的退圈歌手',
    experienceNote:
      '原创人生副本。打开旧搭档与邻居的来信，核对宣传、商量作品或留下吃饭；公开舞台、音频和新作品投递尚未开放。',
  },
  story: {
    title: '退圈后的顶流',
    premise: '一年前停止公开演出，你搬到海边。旧搭档有演出，制作方却未经同意把你的名字放上海报。',
    opening: '搭档说不想来就自己处理，经纪人让你先别答应，邻居只问六点吃不吃饭。',
    tradeoff:
      '重返舞台、远程帮忙或继续普通生活，都有真实关系需要回应；名气不等于每个人都要迁就你。',
  },
  opening: {
    // SPACE-02A author-defined fictional routes; no GPS or real traffic claim.
    space: {
      initialPlaceId: 'seaside_home',
      places: [
        {
          key: 'seaside_home',
          name: '\u6d77\u8fb9\u4f4f\u5904',
          description:
            '\u4f60\u9000\u5708\u540e\u4f4f\u7684\u6d77\u8fb9\u4f4f\u6240\uff0c\u53ef\u4ee5\u4fdd\u7559\u5b89\u9759\u751f\u6d3b\uff1b\u8fd9\u91cc\u6ca1\u6709\u9ed8\u8ba4\u767b\u53f0\u5b89\u6392\u3002',
          actorKeys: ['songqing'],
          invitationKeys: [],
        },
        {
          key: 'cheng_shop',
          name: '\u7a0b\u6653\u7684\u5c0f\u5e97',
          description:
            '\u4e0e\u4f60\u7684\u4f4f\u5904\u5728\u540c\u8857\u533a\u7684\u5c0f\u5e97\u3002\u665a\u996d\u9080\u8bf7\u5c1a\u672a\u4ee3\u8868\u4f60\u5df2\u63a5\u53d7\u6216\u5df2\u7ecf\u5403\u996d\u3002',
          actorKeys: ['chengxiao'],
          invitationKeys: ['meal'],
        },
        {
          key: 'old_venue',
          name: '\u65e7\u57ce\u6f14\u51fa\u573a\u5730',
          description:
            '\u9646\u58f0\u4eca\u665a\u6f14\u51fa\u7684\u573a\u5730\u3002\u5230\u8fbe\u4e0d\u4ee3\u8868\u540c\u610f\u590d\u51fa\u3001\u7b7e\u7ea6\u6216\u767b\u53f0\u3002',
          actorKeys: ['lusheng', 'jiyuan'],
          invitationKeys: ['show'],
        },
      ],
      routes: [
        {
          key: 'seaside_home_to_cheng_shop',
          from: 'seaside_home',
          to: 'cheng_shop',
          minutes: 5,
          modeLabel: '\u6545\u4e8b\u8bbe\u5b9a\u7684\u884c\u7a0b',
        },
        {
          key: 'cheng_shop_to_seaside_home',
          from: 'cheng_shop',
          to: 'seaside_home',
          minutes: 5,
          modeLabel: '\u6545\u4e8b\u8bbe\u5b9a\u7684\u884c\u7a0b',
        },
        {
          key: 'seaside_home_to_old_venue',
          from: 'seaside_home',
          to: 'old_venue',
          minutes: 95,
          modeLabel: '\u6545\u4e8b\u8bbe\u5b9a\u7684\u884c\u7a0b',
        },
        {
          key: 'old_venue_to_seaside_home',
          from: 'old_venue',
          to: 'seaside_home',
          minutes: 95,
          modeLabel: '\u6545\u4e8b\u8bbe\u5b9a\u7684\u884c\u7a0b',
        },
        {
          key: 'cheng_shop_to_old_venue',
          from: 'cheng_shop',
          to: 'old_venue',
          minutes: 95,
          modeLabel: '\u6545\u4e8b\u8bbe\u5b9a\u7684\u884c\u7a0b',
        },
        {
          key: 'old_venue_to_cheng_shop',
          from: 'old_venue',
          to: 'cheng_shop',
          minutes: 95,
          modeLabel: '\u6545\u4e8b\u8bbe\u5b9a\u7684\u884c\u7a0b',
        },
      ],
    },
    startAt: '2026-10-09T06:10:00.000Z',
    identity:
      '你28岁，是一年前停止公开演出的原创歌手，如今住在海边。陆声是旧搭档，唐梨是前经纪人，邻居程晓经营小店。大家还记得你的作品，也有人只把你当熟人。',
    setting:
      '下午14:10。陆声今晚20:00有演出，你尚未答应参与。程晓邀请你18:00吃饭，你可以先听详情，也可以保留安静的生活。',
    actors: [
      {
        key: 'tangli',
        name: '唐梨',
        relationship: '前经纪人',
        persona:
          '29岁，熟悉主角能力与过去，希望促成复出又怕耗尽。公事简洁、私下偶尔损人，不每轮老师老师。制作方今天11:35未经授权把主角名放上海报，你正在问季远，只在实际核对后告知结果。能谈条件、撤宣传、提供信息，不代签或默认登台。你只知道被告知的退圈原因，不凭空编前任背叛；不知邻居晚饭或搭档私聊。若玩家拒绝就认真谈边界，不自动新邀约逼回来。',
      },
      {
        key: 'lusheng',
        name: '陆声',
        relationship: '曾很亲密的旧搭档',
        persona:
          '28岁，今晚20:00演出，希望自己撑起来，不愿求人，急时短句夹旧习惯。你没授意海报，知道已发但不知制作人内部盘算。旧作回潮桥段原与你和主角轮流接唱，拟许安接替但分工没定，节目单还是原双人版。三句：潮退的时候，灯还亮着（你）；没说完的话，留给明天（原主角）；各自回来，也能走同一条路（共同回应）。可独唱、请许安接第二句、改词或接受远程建议，需与你和许安分别同意才记采用，不说未发生演出成功。你亲眼见主角一年以前留下收尾，只能作为自己的印象说总是他收尾，不当全史事实。没有合同逼他回来，未获同意不替他复出。',
      },
      {
        key: 'jiyuan',
        name: '季远',
        relationship: '演出制作人',
        persona:
          '32岁，想维持项目票房，会说大家都不容易，擅谈条件但非单一黑心人。你11:35把可能参加的主角名字擅自宣传，没有授权，核对时可承认、撤下或谈有限出现。拒绝不算主角违约，未真正更正以前不能说已经撤。20:00演出，拟出场者18:30集合；主角海边住处来程单程95分钟，不能承诺18:00吃饭后仍18:30到。可协商迟到、只一首歌、不采访，不能代接受或用假新闻保证全网爆红。不知道邻居或旧搭档私人关系。',
      },
      {
        key: 'chengxiao',
        name: '程晓',
        relationship: '海边邻居，经营小店的朋友',
        persona:
          '27岁，知道主角赖床懒洗杯子的普通一面，自己经营小店，不崇拜。具体、自然、能不耐烦。今天邀请18:00吃饭，没获确认不算主角失约；只一次拒绝不能说长期放鸽子。你还计划明天只请熟人晚饭，有朋友想擅自加人，可请主角帮拟这次晚饭不对外接客的回复，待对方回应才算名单明确。不知演出安排/海报/歌分工，主角实际告诉后才谈。可以改期、拒等、分享日常，不用偷拍危机逼主角复出。',
      },
      {
        key: 'songqing',
        name: '宋青',
        relationship: '母亲',
        persona:
          '52岁，希望主角安稳，也为作品骄傲。问饭睡眠、家里食物，可偶尔一句感慨，不知今天临时海报或演出，收到实际告知才回应。上周寄家里东西，想下周来海边，尚未敲定。不能替他答应演出、诊断退圈原因、要求原谅旧人。没新照片文件就只有文字，不假装已经发饭图。',
      },
      {
        key: 'xuan',
        name: '许安',
        relationship: '受你作品影响的年轻歌手',
        persona:
          '24岁，曾受主角帮助，听回潮想登台，参与今晚演出，紧张时话多，熟悉后有自己的判断。只知道排练与歌曲分工，没确认接唱位置；问作品时能说具体疑问，不无限崇拜或全网都等你。你可接没说完的话留给明天，或提出转调/独唱顾虑。与你和陆声分别明确采纳后才能说分工确定，不能虚构唱完、音频生成或主角到场。不了解季远授权谈判/主角退圈心情/邻居私聊。',
      },
    ],
    actorTies: [
      { fromKey: 'tangli', toKey: 'jiyuan', relationship: '经纪人与演出制作合作', mayShare: true },
      { fromKey: 'jiyuan', toKey: 'tangli', relationship: '演出制作与经纪合作', mayShare: true },
      {
        fromKey: 'lusheng',
        toKey: 'xuan',
        relationship: '同场演出的歌手与排练伙伴',
        mayShare: true,
      },
      { fromKey: 'xuan', toKey: 'lusheng', relationship: '同场演出的排练伙伴', mayShare: true },
    ],
    facts: [
      {
        key: 'public',
        text: '主角28岁，一年前停止公开演出，两个月前搬到海边。今晚没有主角确认的演出合同，不知道本人退圈原因的人不能猜成事实。',
        visibility: { kind: 'world' },
      },
      {
        key: 'poster',
        text: '季远今天11:35未经主角授权发布含主角名字的宣传；唐梨正在核对，陆声未授意。更正必须实际执行，不因玩家要求就说已撤。',
        visibility: { kind: 'actors', actorKeys: ['jiyuan', 'tangli'] },
      },
      {
        key: 'song',
        text: '回潮桥段原为双人轮流接唱；许安拟替主角但位置待定，节目单仍旧版。三句：潮退的时候，灯还亮着（陆声）；没说完的话，留给明天（原主角）；各自回来，也能走同一条路（共同）。采纳需陆声和许安回应，未演出不能说唱完。',
        visibility: { kind: 'actors', actorKeys: ['lusheng', 'xuan'] },
      },
      {
        key: 'travel',
        text: '海边住处与程晓店同街区。到旧城场地单程95分钟，拟登台者18:30集合，20:00开演；18:00晚饭和18:30集合不能按正常行程都准时。',
        visibility: { kind: 'actors', actorKeys: ['jiyuan', 'tangli', 'lusheng'] },
      },
      {
        key: 'private_dinner',
        text: '程晓计划明天仅请熟人晚饭，朋友想擅自加人，尚未获得同意；不因主角有名就公开邀请。',
        visibility: { kind: 'actors', actorKeys: ['chengxiao'] },
      },
    ],
    messages: [
      {
        key: 'agent_quiet',
        actorKey: 'tangli',
        text: '知道你现在不想被安排。要联系工作我会先问你。',
        minutesBeforeStart: 16900,
        history: true,
      },
      {
        key: 'partner_invite',
        actorKey: 'lusheng',
        text: '后天20:00有演出。回潮那段我还没想好，愿意的话听我说说？不来也行。',
        minutesBeforeStart: 2820,
        history: true,
      },
      {
        key: 'producer_assemble',
        actorKey: 'jiyuan',
        text: '今天出场的人18:30集合。你这边没确认，我先不算进名单。',
        minutesBeforeStart: 190,
        history: true,
      },
      {
        key: 'neighbor_key',
        actorKey: 'chengxiao',
        text: '钥匙别放门口。垃圾袋在门后，别再买错了。',
        minutesBeforeStart: 16820,
        history: true,
      },
      {
        key: 'mom_package',
        actorKey: 'songqing',
        text: '东西寄到了没有？别光喝咖啡，饭总得吃。',
        minutesBeforeStart: 10010,
        history: true,
      },
      {
        key: 'singer_song',
        actorKey: 'xuan',
        text: '当年听你的回潮才想上台。桥段我有点问题，哪天方便请教？',
        minutesBeforeStart: 2790,
        history: true,
      },
      {
        key: 'now_neighbor',
        actorKey: 'chengxiao',
        text: '六点吃饭？这次我不等你饿了才想起来。',
        minutesBeforeStart: 110,
        history: false,
      },
      {
        key: 'now_agent',
        actorKey: 'tangli',
        text: '先别答应任何人。你名字在海报上，这件事我正在问。',
        minutesBeforeStart: 24,
        history: false,
      },
      {
        key: 'now_partner',
        actorKey: 'lusheng',
        text: '不是我让他们把你名字放上去的。你不想来，我自己处理。',
        minutesBeforeStart: 8,
        history: false,
      },
    ],
    invitations: [
      {
        key: 'show',
        title: '陆声的演出邀请',
        minutesAfterStart: 350,
        actorKeys: ['lusheng'],
        sourceMessageKey: 'partner_invite',
      },
      {
        key: 'meal',
        title: '和程晓吃饭',
        minutesAfterStart: 230,
        actorKeys: ['chengxiao'],
        sourceMessageKey: 'now_neighbor',
      },
    ],
    notes: [
      {
        key: 'today',
        title: '今天别忘了',
        text: '陆声20:00演出和程晓18:00吃饭都是邀请，还没答应。去旧城单程95分钟，拟登台18:30集合，两个时间不能都按原安排赶上。可以改时间，也可以不参与。',
      },
      {
        key: 'old_work',
        title: '旧作品 · 回潮',
        text: '留下的三句：潮退的时候，灯还亮着。没说完的话，留给明天。各自回来，也能走同一条路。原来与陆声轮流接唱。新分工和是否参与，先和他及许安商量；这里没有可播放的新音频。',
      },
      {
        key: 'life',
        title: '海边的小事',
        text: '钥匙、咖啡、总忘洗的杯子。程晓的小店在同一街区，母亲上周寄了家里东西。这段生活不必每次都回到聚光灯里。',
      },
    ],
  },
};
