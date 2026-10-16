import {
  PublisherPreparationInputSchema,
  type PublisherPreparationInput,
} from '../contracts/publisher-preparation.ts';

/** The trusted purpose is part of the durable admission fingerprint, never a draft field. */
export function characterTrialPreparationInput(input: PublisherPreparationInput) {
  if (input.scope === 'characters' || input.socialFocus || input.socialActorKey)
    throw Object.assign(Error('INVALID_INPUT'), { code: 'INVALID_INPUT' });
  return PublisherPreparationInputSchema.parse({
    ...input,
    scope: 'world',
    sources: [
      ...input.sources,
      {
        filename: '平台说明_角色私有试演.txt',
        content:
          '本次操作是准备角色的私有微信试聊。运行所需的缺项由项目Agent提出补充；作者原人设、人物数量、介绍、图片与已有剧情保留。不自动发布。每个开场已认识的角色要有可查看的朋友圈正文；已确认熟人关系的角色要有普通双向历史聊天。只补缺口，原聊天和动态逐字保留，不新增角色，不把未来剧情写成历史。这份说明属于平台操作目的，不是作者剧本中的事实。',
      },
    ],
  });
}
