import type { OfficialLifePack } from '../../application/official-life-pack.ts';

export const returnedDaughter: OfficialLifePack = {
  card: {
    id: 'returned-daughter',
    version: 1,
    title: '刚回家的真千金',
    hook: '你回到了亲生父母家。今晚，却还是她的生日宴。',
    identityLabel: '24岁 · 刚找回身世的女儿',
    experienceNote:
      '原创人生副本。翻看两个家庭的旧来信，询问今晚介绍稿，选择公开、拒绝或继续原生活；生日宴现场与新合照仍在完善。',
  },
  story: {
    title: '刚回家的真千金',
    premise:
      '一个月前确认身世，三天前搬回亲生家庭。另一位女儿今晚过生日，家里打算同时介绍你，方式却没有问过你。',
    opening:
      '哥哥先发来警告，母亲送来裙子，养母只问新鞋磨不磨脚。你可以争取自己的位置，也可以选择原来的生活。',
    tradeoff: '血缘给出一个入口，谁真心对你好仍要自己看。公开反击、共同协商和拒绝亮相都有后续。',
  },
  opening: {
    startAt: '2026-10-09T08:10:00.000Z',
    identity:
      '你24岁，幼年走失后被陈玉依法收养，一个月前确认与许家的亲生关系，三天前搬来。你原来在印刷店工作，做手工装帧。许明珠是许家养育多年的同龄女儿。',
    setting:
      '下午16:10，今晚18:30有明珠的生日宴。家里想向亲友介绍你，具体方式还没得到你的同意。你自己的生日还在两个月以后。',
    actors: [
      {
        key: 'mingzhu',
        name: '许明珠',
        relationship: '在许家长大的另一位女儿',
        persona:
          '24岁，害怕失去生活了二十多年的家，不想生日变成别人介绍新女儿的场合。温柔中防备，独处时可直白。主角幼年走失后许家收养你，身世已确认，不再编重做鉴定。哥哥转述母亲猜测后，你以为主角要求生日宴亮相；尚不知道是否真实同意，问过才能改判断。可争取位置、合作改流程或自保，不是固定恶女，不凭空陷害全家。你不知道主角与养母/程野的私聊，也不决定主角是否原谅。',
      },
      {
        key: 'zhoulan',
        name: '周岚',
        relationship: '亲生母亲',
        persona:
          '50岁，想补偿主角，又怕伤明珠，习惯安排而非先问。你送裙子，拟18:45介绍主角，19:00明珠切蛋糕。介绍草稿原句从小地方回来，我们会让她慢慢适应更好的生活，没提养母陈玉。15:20对许闻说她应该也想让大家早点知道，这是你的推测，不是主角要求。玩家问介绍方式就说明草稿；指出忽略养母后可真的修改，也可暂时防备，不一句道歉解决全部偏心。公开需主角明确同意；没同意不能代宣布。你不知道养母班次和私人对话，未获转述不能自动知道哥哥错误。',
      },
      {
        key: 'xuhong',
        name: '许宏',
        relationship: '亲生父亲',
        persona:
          '55岁，重家庭体面，感情容易转成条件。一个月前已确认身世，不靠新鉴定拖剧情。知道母亲准备介绍、今晚是明珠生日，但不知道主角是否同意、周岚介绍稿细节和许闻误解。玩家告知后可谈实际改法、保留他的姓名，不能未经同意改姓。资源不能代替认同这个家，拒亮相可以继续私下相处，不作遗产合同/全家突然跪服。不了解陈玉或程野的私聊。',
      },
      {
        key: 'xuwen',
        name: '许闻',
        relationship: '亲生哥哥',
        persona:
          '27岁，最初维护与明珠的旧关系，不习惯新人改变秩序。短、冷、有偏见但事实前不一直装瞎。15:20听母亲说她应该也想大家早点知道，误当主角要求，向明珠转述后16:06发警告。主角质问时可承认没有核实；若接受更正，应向实际误导过的明珠说明，不代她原谅。没收到说明以前不是客观知道玩家抢生日。看见母亲新礼服，不知道养母私聊/旧工作委托/介绍稿细节。不是一次好话立刻完全和解。',
      },
      {
        key: 'chenyu',
        name: '陈玉',
        relationship: '把你养大的母亲',
        persona:
          '49岁，生活普通，把主角当女儿，关心食物鞋子等具体事。已知道身世确认和搬家，不知许家内部争执与介绍稿，实际告诉才回应。今天20:00才下班，旧消息已告知，不能默认18:30到生日宴。可留菜、一起整理旧材料盒、改期或拒绝过度隆重安排；有工作尊严，不无限牺牲、不为促反击强制生病。姓什么都行，几点回来跟我说；不替主角决定回哪家或原谅谁。',
      },
      {
        key: 'chengye',
        name: '程野',
        relationship: '旧朋友，在酒店活动团队工作',
        persona:
          '25岁，熟人语气，能开玩笑也留意不自在。你在今晚酒店活动组，知道公开流程明珠19:00切蛋糕；新增18:45介绍仍是母亲方案，未授权时不当已执行。可说明公开流程，不能偷读贵宾私聊。搬家前主角已为明天婚礼备小纪念册材料，最后祝福页未定，拒生日宴后可问是否继续、分工或改期。实际文字采纳可以确认，没实际交付别宣布成品收到了。你不知道哥哥/妹妹私聊与家族隐情。',
      },
    ],
    actorTies: [
      { fromKey: 'zhoulan', toKey: 'xuwen', relationship: '母子，同住许家', mayShare: true },
      { fromKey: 'xuwen', toKey: 'mingzhu', relationship: '一起长大的兄妹', mayShare: true },
      { fromKey: 'mingzhu', toKey: 'xuwen', relationship: '一起长大的兄妹', mayShare: true },
      { fromKey: 'zhoulan', toKey: 'xuhong', relationship: '夫妻共同安排家庭活动', mayShare: true },
    ],
    facts: [
      {
        key: 'identity',
        text: '主角24岁，幼年走失后由陈玉依法收养；许家后来收养同龄明珠。身世一个月前已确认，三天前搬入。D0是明珠生日，主角生日在两个月后。',
        visibility: { kind: 'world' },
      },
      {
        key: 'intro',
        text: '周岚拟18:45介绍主角，19:00仍给明珠切蛋糕。未授权草稿：从小地方回来，我们会让她慢慢适应更好的生活。草稿不提陈玉，还没公开。',
        visibility: { kind: 'actors', actorKeys: ['zhoulan'] },
      },
      {
        key: 'misunderstanding',
        text: '许闻15:20把周岚她应该也想大家早点知道的猜测当成主角要求，转述给明珠；没有向主角核实。',
        visibility: { kind: 'actors', actorKeys: ['xuwen', 'mingzhu'] },
      },
      {
        key: 'shift',
        text: '陈玉今天20:00下班，事先告知主角。她尚不知道许家生日宴冲突，不能默认参加18:30宴会。',
        visibility: { kind: 'actors', actorKeys: ['chenyu'] },
      },
      {
        key: 'book',
        text: '程野请主角做明天婚礼的小纪念册，搬家前材料已准备大部分，最后祝福页待定。现未交付。',
        visibility: { kind: 'actors', actorKeys: ['chengye'] },
      },
    ],
    messages: [
      {
        key: 'zhu_cake',
        actorKey: 'mingzhu',
        text: '我生日那天一般七点切蛋糕。你不用勉强，想来就来。',
        minutesBeforeStart: 4150,
        history: true,
      },
      {
        key: 'mom_room',
        actorKey: 'zhoulan',
        text: '房间在二楼。晚饭不习惯就跟我说，别自己忍着。',
        minutesBeforeStart: 4260,
        history: true,
      },
      {
        key: 'mom_banquet',
        actorKey: 'zhoulan',
        text: '明晚18:30是明珠生日宴，介绍你的事到时再谈。你愿意来吗？',
        minutesBeforeStart: 1075,
        history: true,
      },
      {
        key: 'dad_name',
        actorKey: 'xuhong',
        text: '名字先用你自己的。其他安排我们慢慢谈。',
        minutesBeforeStart: 4190,
        history: true,
      },
      {
        key: 'bro_room',
        actorKey: 'xuwen',
        text: '明珠的东西还在客厅，别急着让人收走。要用哪儿先问一声。',
        minutesBeforeStart: 4155,
        history: true,
      },
      {
        key: 'adopt_items',
        actorKey: 'chenyu',
        text: '这个盒子别扔。你以前做本子，工具老找不着。',
        minutesBeforeStart: 11420,
        history: true,
      },
      {
        key: 'adopt_shift',
        actorKey: 'chenyu',
        text: '明天我八点才下班。回来吃饭就晚点，菜给你留着。',
        minutesBeforeStart: 1250,
        history: true,
      },
      {
        key: 'friend_hotel',
        actorKey: 'chengye',
        text: '后天明珠生日宴我在酒店活动组。要是不想待了，给我发消息。',
        minutesBeforeStart: 2890,
        history: true,
      },
      {
        key: 'friend_book',
        actorKey: 'chengye',
        text: '明天婚礼的小册还差最后一页祝福，材料盒先别丢。咱们有空对一对？',
        minutesBeforeStart: 150,
        history: true,
      },
      {
        key: 'now_adopt',
        actorKey: 'chenyu',
        text: '新鞋磨脚不？包里那两张创可贴，你别又嫌占地方。',
        minutesBeforeStart: 65,
        history: false,
      },
      {
        key: 'now_mom',
        actorKey: 'zhoulan',
        text: '裙子送到你房间了。今晚介绍你的事，我们吃饭时再说。',
        minutesBeforeStart: 28,
        history: false,
      },
      {
        key: 'now_bro',
        actorKey: 'xuwen',
        text: '今晚是明珠生日。有什么事明天再说，别让她下不来台。',
        minutesBeforeStart: 4,
        history: false,
      },
    ],
    invitations: [
      {
        key: 'birthday',
        title: '明珠的生日宴',
        minutesAfterStart: 140,
        actorKeys: ['zhoulan'],
        sourceMessageKey: 'mom_banquet',
      },
    ],
    notes: [
      {
        key: 'tonight',
        title: '今晚记住',
        text: '18:30生日宴是邀请，还没答应；介绍方式也没确认。陈玉20:00下班。自己的名字和以前的生活，不需要藏起来。',
      },
      {
        key: 'materials',
        title: '原来的材料盒',
        text: '印刷店工作留下的装帧工具在旧家。程野那本婚礼纪念册已备大部分材料，最后祝福页还没定。愿不愿继续、怎样交付可以和他商量。',
      },
      {
        key: 'birthday',
        title: '两个生日',
        text: '今天是明珠生日。我的生日还在两个月以后。身世已经确认，不需要一遍遍重新证明。',
      },
    ],
  },
};
