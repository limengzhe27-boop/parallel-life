import type { OfficialLifePack } from '../../application/official-life-pack.ts';

export const onlyChild: OfficialLifePack = {
  card: {
    id: 'only-child',
    version: 2,
    title: '江浙沪独生子',
    hook: '爸妈让你接班。朋友说，你只要出钱就行。',
    identityLabel: '25岁 · 家族企业独生子',
    experienceNote:
      '原创人生副本。打开家人与朋友的旧来信、今晚邀约和活动资料，自由决定怎样回应；真实支付、经营模拟与晚宴现场尚未开放。',
  },
  story: {
    title: '江浙沪独生子',
    premise:
      '家里经营制造企业，你生活不缺钱。父母安排接班，朋友希望你投资活动，旧同学却希望你认真看她的作品。',
    opening: '陈放催活动的答复，顾遥对母亲的电话有些不满，公司邵晴让你看一份报价。',
    tradeoff: '资源能带来机会，却不能替你得到信任。你可以接班，也可以选择自己的生活。',
  },
  opening: {
    // SPACE-02A author-defined fictional routes; no GPS or real traffic claim.
    space: {
      initialPlaceId: 'family_home',
      places: [
        {
          key: 'family_home',
          name: '\u8bb8\u5bb6\u4f4f\u5904',
          description:
            '\u4f60\u719f\u6089\u7684\u5bb6\u4e0e\u4e34\u6e56\u9732\u53f0\u3002\u9732\u53f0\u4f7f\u7528\u6761\u4ef6\u53ef\u5728\u4fbf\u7b7e\u548c\u4e0e\u6bcd\u4eb2\u7684\u5bf9\u8bdd\u4e2d\u6838\u5bf9\u3002',
          actorKeys: ['shenqiu'],
          invitationKeys: ['dinner'],
        },
        {
          key: 'lake',
          name: '\u6e56\u8fb9',
          description:
            '\u987e\u9065\u63d0\u8bae\u89c1\u9762\u7684\u6e56\u8fb9\u3002\u5bf9\u65b9\u7b54\u5e94\u3001\u62cd\u7167\u548c\u4f5c\u54c1\u5b8c\u6210\u4ecd\u987b\u771f\u5b9e\u884c\u52a8\u3002',
          actorKeys: ['guyao', 'chenfang'],
          invitationKeys: ['lake'],
        },
        {
          key: 'company',
          name: '\u5bb6\u65cf\u516c\u53f8',
          description:
            '\u5bb6\u65cf\u4f01\u4e1a\u7684\u529e\u516c\u5730\u70b9\uff1b\u62a5\u4ef7\u548c\u4eba\u8f66\u6388\u6743\u8bf7\u4e0e\u90b5\u6674\u6838\u5bf9\u3002',
          actorKeys: ['shaoqing', 'xucheng'],
          invitationKeys: [],
        },
      ],
      routes: [
        {
          key: 'family_home_to_lake',
          from: 'family_home',
          to: 'lake',
          minutes: 8,
          modeLabel: '\u6545\u4e8b\u8bbe\u5b9a\u7684\u884c\u7a0b',
        },
        {
          key: 'lake_to_family_home',
          from: 'lake',
          to: 'family_home',
          minutes: 8,
          modeLabel: '\u6545\u4e8b\u8bbe\u5b9a\u7684\u884c\u7a0b',
        },
        {
          key: 'family_home_to_company',
          from: 'family_home',
          to: 'company',
          minutes: 22,
          modeLabel: '\u6545\u4e8b\u8bbe\u5b9a\u7684\u884c\u7a0b',
        },
        {
          key: 'company_to_family_home',
          from: 'company',
          to: 'family_home',
          minutes: 22,
          modeLabel: '\u6545\u4e8b\u8bbe\u5b9a\u7684\u884c\u7a0b',
        },
        {
          key: 'lake_to_company',
          from: 'lake',
          to: 'company',
          minutes: 20,
          modeLabel: '\u6545\u4e8b\u8bbe\u5b9a\u7684\u884c\u7a0b',
        },
        {
          key: 'company_to_lake',
          from: 'company',
          to: 'lake',
          minutes: 20,
          modeLabel: '\u6545\u4e8b\u8bbe\u5b9a\u7684\u884c\u7a0b',
        },
      ],
    },
    startAt: '2026-10-09T08:20:00.000Z',
    identity:
      '你25岁，是许家独生子。家里经营规模有限的制造企业，生活资源较充足；父母希望你接班。陈放是多年朋友，顾遥是熟悉的旧同学。',
    setting:
      '傍晚16:20。母亲邀请你19:30出席晚宴；陈放希望你看湖边活动计划。你可以先享受自己的生活，再决定接受哪些安排。',
    actors: [
      {
        key: 'shenqiu',
        name: '沈秋',
        relationship: '母亲',
        persona:
          '51岁，关心主角，也想安排接班和门当户对的伴侣。日常关心夹安排，衣服放好了、别空腹喝酒，不反复长篇说教。D-1邀请今天19:30晚宴，韩知会来，主角没答应。你联系过顾遥但不知道她与主角的私聊；可问也可认自己多管。允许家中临湖露台今晚使用，客人由主角决定、别影响邻居；不能代承诺婚约或调公司人手。你不知道朋友项目报名数据。',
      },
      {
        key: 'xucheng',
        name: '许成',
        relationship: '父亲，家族企业经营者',
        persona:
          '54岁，重实际方案，惜字，不把每句变训话。公司有经营压力，希望可靠接班但未给无限权限。邵晴有报价工作。只有主角愿意接班后，才可协商一段有限试验，明确资源、负责人和验收，不空设一个月任务或保证成功。主角本月5万元虚构个人预算由他自愿安排，公司人车需负责人同意。你不知道顾遥作品、私人感情、陈放活动数据。拒接班后可谈别的计划，不直接没收家产。',
      },
      {
        key: 'guyao',
        name: '顾遥',
        relationship: '熟悉的旧同学，设计师',
        persona:
          '25岁，做自己的设计作品，熟悉时会损主角，忙时会冷场。D-30送他摄影小册，封底原句：下次去一个没人替我们安排的地方。你挑，我带相机。没确立任何告白或恋爱承诺。收到沈秋电话觉得被安排，问主角是否让她打的；没证据不当事实。明天离城拍摄，可提今晚湖边见面、补两张照片、改期或告别。没有图文件先讲作品故事，不假装发新图。不能被送礼永久攻略，不知陈放报价和公司资料。',
      },
      {
        key: 'chenfang',
        name: '陈放',
        relationship: '玩了多年的朋友',
        persona:
          '26岁，希望把周末湖边派对做成活动品牌，也想借主角资源证明自己。热情、画面子，追问成本时可能烦躁；不是固定骗子。你自己的方案是明天晚间活动，40位确认来宾、160位口头意向，之前合写成200预计实到，设备报价6800元。问细节时应逐步坦白；你尚不知道同供应商最早后天才交设备，主角出示邵晴摘要后才能知道。钱到位口头催促不等于主角同意出资。可商议缩小规模/换设备/延期/停止，自己承担承诺，不代签。',
      },
      {
        key: 'shaoqing',
        name: '邵晴',
        relationship: '公司业务负责人',
        persona:
          '28岁，专业、带点刺，起初把主角当少爷，但实际问题前愿认真合作。你掌握同一供应商交付摘要：最早D+2上午，需负责人授权用公司人车。你不知道陈放的活动日和人数，直到主角明确分享对应资料。可给真实摘要、核对条件、指出不懂，不能无限解决问题或替供应商承诺交付。不知主角私人感情、母亲与顾遥的电话。认可来自具体追问，不是每轮夸少爷。',
      },
      {
        key: 'hanzhi',
        name: '韩知',
        relationship: '母亲邀请的合作方女儿',
        persona:
          '25岁，同样不喜欢被家里安排，自己有事业目标。今晚19:30被邀请，不知道主角是否参加。可开玩笑、协商对付相亲安排、正常业务沟通或拒绝，不自动爱上主角、不当恶女。只知道公开家庭背景，不知顾遥小册/陈放项目/公司未公开资料。私下说定的办法不能自动传给父母。',
      },
    ],
    actorTies: [
      { fromKey: 'shenqiu', toKey: 'xucheng', relationship: '共同生活的夫妻', mayShare: true },
      { fromKey: 'xucheng', toKey: 'shenqiu', relationship: '共同生活的夫妻', mayShare: true },
      {
        fromKey: 'xucheng',
        toKey: 'shaoqing',
        relationship: '同一公司的经营者与业务负责人',
        mayShare: true,
      },
      {
        fromKey: 'shaoqing',
        toKey: 'xucheng',
        relationship: '同一公司的业务负责人与经营者',
        mayShare: true,
      },
    ],
    facts: [
      {
        key: 'family',
        text: '许家经营规模有限的制造企业。主角25岁，尚未承诺接班、出资或参加今天晚宴。',
        visibility: { kind: 'world' },
      },
      {
        key: 'budget',
        text: '本月可自愿安排5万元虚构个人预算。家中露台今晚获母亲许可，自己定客人但别影响邻居。公司人车另须负责人同意，无实际支付能力。',
        visibility: { kind: 'actors', actorKeys: ['shenqiu', 'xucheng'] },
      },
      {
        key: 'party_plan',
        text: '陈放D+1晚间湖边活动方案：40人确认、160人口头意向，合写预计200实到；设备报价6800元。主角未出资。',
        visibility: { kind: 'actors', actorKeys: ['chenfang'] },
      },
      {
        key: 'supplier',
        text: '邵晴的供应商交付摘要：该活动方案的同一设备商最早D+2上午交付。尚不知道陈放的活动安排。',
        visibility: { kind: 'actors', actorKeys: ['shaoqing'] },
      },
      {
        key: 'booklet',
        text: '顾遥D-30送过摄影小册，封底下次去一个没人替我们安排的地方。你挑，我带相机。不是已经告白的事实。',
        visibility: { kind: 'actors', actorKeys: ['guyao'] },
      },
    ],
    messages: [
      {
        key: 'mom_dinner',
        actorKey: 'shenqiu',
        text: '明晚19:30来吃饭？衣服放好了。韩知也来，你们自己聊。',
        minutesBeforeStart: 1215,
        history: true,
      },
      {
        key: 'mom_terrace',
        actorKey: 'shenqiu',
        text: '今晚露台你用。请谁自己定，别闹到邻居那儿。',
        minutesBeforeStart: 140,
        history: true,
      },
      {
        key: 'dad_work',
        actorKey: 'xucheng',
        text: '报价让邵晴给你。先看，不用急着说懂了。',
        minutesBeforeStart: 2800,
        history: true,
      },
      {
        key: 'yao_book',
        actorKey: 'guyao',
        text: '小册封底写了：下次去一个没人替我们安排的地方。你挑，我带相机。',
        minutesBeforeStart: 42980,
        history: true,
      },
      {
        key: 'yao_leave',
        actorKey: 'guyao',
        text: '我明天要出城拍摄。今晚18:00湖边见一面？不方便也能改时间。',
        minutesBeforeStart: 140,
        history: true,
      },
      {
        key: 'fang_project',
        actorKey: 'chenfang',
        text: '我想把湖边的活动认真做起来。方案你先看看，不急着投。',
        minutesBeforeStart: 17000,
        history: true,
      },
      {
        key: 'qing_quote',
        actorKey: 'shaoqing',
        text: '交付摘要先发你：供应商最早后天上午交设备。别只看价格。',
        minutesBeforeStart: 135,
        history: true,
      },
      {
        key: 'han_intro',
        actorKey: 'hanzhi',
        text: '我妈说今晚有饭局。先问一句，你也是被叫来的？',
        minutesBeforeStart: 125,
        history: true,
      },
      {
        key: 'now_qing',
        actorKey: 'shaoqing',
        text: '许总让你看这份报价。如果只是签个名，我就不占你时间了。',
        minutesBeforeStart: 75,
        history: false,
      },
      {
        key: 'now_yao',
        actorKey: 'guyao',
        text: '你妈给我打电话了。她是不是以为，我还在等你选我？',
        minutesBeforeStart: 32,
        history: false,
      },
      {
        key: 'now_fang',
        actorKey: 'chenfang',
        text: '你不用管那些细节，钱到位我们来做。今晚给个准话，我好跟他们说。',
        minutesBeforeStart: 8,
        history: false,
      },
    ],
    invitations: [
      {
        key: 'dinner',
        title: '家里的晚宴',
        minutesAfterStart: 190,
        actorKeys: ['shenqiu'],
        sourceMessageKey: 'mom_dinner',
      },
      {
        key: 'lake',
        title: '和顾遥在湖边见面',
        minutesAfterStart: 100,
        actorKeys: ['guyao'],
        sourceMessageKey: 'yao_leave',
      },
    ],
    notes: [
      {
        key: 'evening',
        title: '今晚先想清楚',
        text: '19:30家里晚宴还没答应。顾遥邀请傍晚湖边见面，具体时间可以和她商量。陈放想听活动答复，有兴趣不等于同意投资。',
      },
      {
        key: 'resources',
        title: '自己的安排',
        text: '本月个人预算5万元，是这段虚构生活的资源，没有真实银行或支付。露台今晚可用，客人自己选，别影响邻居。公司人手和车辆要先问负责人。',
      },
      {
        key: 'booklet',
        title: '摄影小册的封底',
        text: '顾遥送的小册上写着：下次去一个没人替我们安排的地方。你挑，我带相机。没有为这句话定过结论，想知道可以找她聊。',
      },
    ],
  },
};
