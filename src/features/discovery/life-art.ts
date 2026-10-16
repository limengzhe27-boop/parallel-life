import type { OfficialLifeId } from '../../contracts/official-lives.ts';
export type OfficialLifeArt = Readonly<{
  id: OfficialLifeId;
  coverUrl: string;
  wallpaperUrl: string;
  label: '原创插画';
  alt: string;
}>;
/** Editorial decoration; never a photo, generated scene or saved story event. */
const arts: readonly (OfficialLifeArt & { title: string; identity: string })[] = [
  {
    id: 'county-yellow-hair',
    title: '县城黄毛',
    identity:
      '你23岁，在南桥县的修车铺工作，头发染得张扬。林悦是交往半年的女友；阿杰是从小一起长大的朋友。你有自己的手艺，也在想下一步怎样生活。',
    coverUrl: '/art/lives/county-yellow-hair-cover.svg',
    wallpaperUrl: '/art/lives/county-yellow-hair-wallpaper.svg',
    label: '原创插画',
    alt: '傍晚的县城街巷，修车铺亮着暖灯',
  },
  {
    id: 'only-child',
    title: '江浙沪独生子',
    identity:
      '你25岁，是许家独生子。家里经营规模有限的制造企业，生活资源较充足；父母希望你接班。陈放是多年朋友，顾遥是熟悉的旧同学。',
    coverUrl: '/art/lives/only-child-cover.svg',
    wallpaperUrl: '/art/lives/only-child-wallpaper.svg',
    label: '原创插画',
    alt: '暮色中的湖岸露台，远处的灯火映在水面',
  },
  {
    id: 'returned-daughter',
    title: '刚回家的真千金',
    identity:
      '你24岁，幼年走失后被陈玉依法收养，一个月前确认与许家的亲生关系，三天前搬来。你原来在印刷店工作，做手工装帧。许明珠是许家养育多年的同龄女儿。',
    coverUrl: '/art/lives/returned-daughter-cover.svg',
    wallpaperUrl: '/art/lives/returned-daughter-wallpaper.svg',
    label: '原创插画',
    alt: '花影掩映的宅门，长廊尽头透出暖光',
  },
  {
    id: 'retired-star',
    title: '退圈后的顶流',
    identity:
      '你28岁，是一年前停止公开演出的原创歌手，如今住在海边。陆声是旧搭档，唐梨是前经纪人，邻居程晓经营小店。大家还记得你的作品，也有人只把你当熟人。',
    coverUrl: '/art/lives/retired-star-cover.svg',
    wallpaperUrl: '/art/lives/retired-star-wallpaper.svg',
    label: '原创插画',
    alt: '蓝色海岸的窗前，旧音箱和吉他安静放着',
  },
];
function projection(art: (typeof arts)[number]): OfficialLifeArt {
  return {
    id: art.id,
    coverUrl: art.coverUrl,
    wallpaperUrl: art.wallpaperUrl,
    label: art.label,
    alt: art.alt,
  };
}
export function resolveOfficialLifeArt(id?: string): OfficialLifeArt | null {
  const art = arts.find((entry) => entry.id === id);
  return art ? projection(art) : null;
}
/** Legacy public projection has no preset ID: require both exact authored fields. */
export function resolveWorldLifeArt(world: {
  title?: string;
  identity?: string;
}): OfficialLifeArt | null {
  const art = arts.find(
    (entry) => entry.title === world.title && entry.identity === world.identity,
  );
  return art ? projection(art) : null;
}
