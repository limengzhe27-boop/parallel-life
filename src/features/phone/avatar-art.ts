import type { WorldPhone } from '../../contracts/world-build.ts';
import { PublicationAssetUrlSchema } from '../../contracts/publication-assets.ts';
import { resolveWorldLifeArt } from '../discovery/life-art.ts';
export type AvatarArt = Readonly<{
  url: string;
  kind: 'authorized-photo' | 'character-illustration' | 'generic-illustration' | 'publication-art';
  label: string;
}>;
const characterArt = [
  {
    lifeId: 'county-yellow-hair',
    name: '林悦',
    relationship: '交往半年的女友',
    url: '/art/lives/avatar-rose.svg',
  },
  {
    lifeId: 'county-yellow-hair',
    name: '林建国',
    relationship: '林悦的父亲',
    url: '/art/lives/avatar-clay.svg',
  },
  {
    lifeId: 'county-yellow-hair',
    name: '刘航',
    relationship: '林悦的旧同学，与林家有生意往来',
    url: '/art/lives/avatar-indigo.svg',
  },
  {
    lifeId: 'county-yellow-hair',
    name: '阿杰',
    relationship: '一起长大的发小',
    url: '/art/lives/avatar-moss.svg',
  },
  {
    lifeId: 'county-yellow-hair',
    name: '老周',
    relationship: '修车铺师傅',
    url: '/art/lives/avatar-sand.svg',
  },
  {
    lifeId: 'county-yellow-hair',
    name: '陈国强',
    relationship: '父亲',
    url: '/art/lives/avatar-graphite.svg',
  },
  {
    lifeId: 'only-child',
    name: '沈秋',
    relationship: '母亲',
    url: '/art/lives/avatar-plum.svg',
  },
  {
    lifeId: 'only-child',
    name: '许成',
    relationship: '父亲，家族企业经营者',
    url: '/art/lives/avatar-clay.svg',
  },
  {
    lifeId: 'only-child',
    name: '顾遥',
    relationship: '熟悉的旧同学，设计师',
    url: '/art/lives/avatar-rose.svg',
  },
  {
    lifeId: 'only-child',
    name: '陈放',
    relationship: '玩了多年的朋友',
    url: '/art/lives/avatar-moss.svg',
  },
  {
    lifeId: 'only-child',
    name: '邵晴',
    relationship: '公司业务负责人',
    url: '/art/lives/avatar-indigo.svg',
  },
  {
    lifeId: 'only-child',
    name: '韩知',
    relationship: '母亲邀请的合作方女儿',
    url: '/art/lives/avatar-amber.svg',
  },
  {
    lifeId: 'returned-daughter',
    name: '许明珠',
    relationship: '在许家长大的另一位女儿',
    url: '/art/lives/avatar-rose.svg',
  },
  {
    lifeId: 'returned-daughter',
    name: '周岚',
    relationship: '亲生母亲',
    url: '/art/lives/avatar-plum.svg',
  },
  {
    lifeId: 'returned-daughter',
    name: '许宏',
    relationship: '亲生父亲',
    url: '/art/lives/avatar-clay.svg',
  },
  {
    lifeId: 'returned-daughter',
    name: '许闻',
    relationship: '亲生哥哥',
    url: '/art/lives/avatar-indigo.svg',
  },
  {
    lifeId: 'returned-daughter',
    name: '陈玉',
    relationship: '把你养大的母亲',
    url: '/art/lives/avatar-pearl.svg',
  },
  {
    lifeId: 'returned-daughter',
    name: '程野',
    relationship: '旧朋友，在酒店活动团队工作',
    url: '/art/lives/avatar-moss.svg',
  },
  {
    lifeId: 'retired-star',
    name: '唐梨',
    relationship: '前经纪人',
    url: '/art/lives/avatar-amber.svg',
  },
  {
    lifeId: 'retired-star',
    name: '陆声',
    relationship: '曾很亲密的旧搭档',
    url: '/art/lives/avatar-indigo.svg',
  },
  {
    lifeId: 'retired-star',
    name: '季远',
    relationship: '演出制作人',
    url: '/art/lives/avatar-sand.svg',
  },
  {
    lifeId: 'retired-star',
    name: '程晓',
    relationship: '海边邻居，经营小店的朋友',
    url: '/art/lives/avatar-moss.svg',
  },
  {
    lifeId: 'retired-star',
    name: '宋青',
    relationship: '母亲',
    url: '/art/lives/avatar-plum.svg',
  },
  {
    lifeId: 'retired-star',
    name: '许安',
    relationship: '受你作品影响的年轻歌手',
    url: '/art/lives/avatar-olive.svg',
  },
];
/** Display-only assets. Never attach these illustrations to photos or story facts. */
export function resolveAvatarArt(
  world: Pick<WorldPhone, 'id' | 'title' | 'identity'>,
  actor: WorldPhone['actors'][number],
): AvatarArt {
  if (actor.photo)
    return {
      url:
        '/api/v1/assets/' +
        encodeURIComponent(actor.photo.assetId) +
        '?worldId=' +
        encodeURIComponent(world.id) +
        '&revision=' +
        actor.photo.revision,
      kind: 'authorized-photo',
      label: '用户授权照片',
    };
  if (PublicationAssetUrlSchema.safeParse(actor.publicationAvatarUrl).success)
    return {
      url: actor.publicationAvatarUrl!,
      kind: 'publication-art',
      label: 'AI创作的虚构人物形象',
    };
  const official = actor.sourcePersonId ? null : resolveWorldLifeArt(world);
  const portrait = official
    ? characterArt.find(
        (a) =>
          a.lifeId === official.id &&
          a.name === actor.name &&
          a.relationship === actor.relationship,
      )
    : undefined;
  return portrait
    ? { url: portrait.url, kind: 'character-illustration', label: '原创人物插画 · 非真实肖像' }
    : {
        url: '/art/lives/avatar-contact.svg',
        kind: 'generic-illustration',
        label: '通用联系人插画 · 不表示实际外貌',
      };
}
