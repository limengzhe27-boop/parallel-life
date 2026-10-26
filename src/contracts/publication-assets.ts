import { z } from 'zod';

export const PublicationAssetUrlSchema = z
  .string()
  .regex(/^\/publication-art\/[a-z0-9_-]+\.[a-f0-9]{16}\.webp$/);
export type PublicationArt = {
  key: string;
  revision: number;
  label: string;
  url: string;
  sha256: string;
  /** Reusable scene cutout derived from this exact original avatar revision. */
  scenePortrait?: { url: string; sha256: string };
  uses: readonly ('avatar' | 'cover')[];
};
/** Curated original fictional art only. Private user assets can never enter this registry. */
export const PUBLICATION_ART: readonly PublicationArt[] = [
  {
    key: 'qingqing',
    scenePortrait: {
      url: '/publication-art/scene-qingqing.666fc3926a5cee81.png',
      sha256: '666fc3926a5cee817d212f71533c6e5c721874a948bd8654772c182fe43c5ed4',
    },
    revision: 1,
    label: '青青',
    url: '/publication-art/qingqing.dd41bd29cf2c8168.webp',
    sha256: 'dd41bd29cf2c8168e102957fd722de42ab5c16ac080b1ef49a980df2c9ab8191',
    uses: ['avatar'],
  },
  {
    key: 'lin_baiyu',
    scenePortrait: {
      url: '/publication-art/scene-lin_baiyu.869df6fb07904241.png',
      sha256: '869df6fb079042412395cc1709a509539d2f018bd0bb8626a9e6021e76e3287b',
    },
    revision: 1,
    label: '林白语',
    url: '/publication-art/lin_baiyu.f9c65c7b07c290f7.webp',
    sha256: 'f9c65c7b07c290f77533eac1e2788f08cdac86680bf7d2b0cba53a9595ede695',
    uses: ['avatar'],
  },
  {
    key: 'liu_shengnan',
    scenePortrait: {
      url: '/publication-art/scene-liu_shengnan.45468d413d186db9.png',
      sha256: '45468d413d186db966faef92f642a728cad1b498868b74a064482e8af06e757d',
    },
    revision: 1,
    label: '刘胜男',
    url: '/publication-art/liu_shengnan.a0a542b1741810c5.webp',
    sha256: 'a0a542b1741810c53143c9ed7613896582caf3a20808d9b6c413fa5a4288d7d6',
    uses: ['avatar'],
  },
  {
    key: 'li_zhizhi',
    scenePortrait: {
      url: '/publication-art/scene-li_zhizhi.13c1c1974d5044c9.png',
      sha256: '13c1c1974d5044c9d729620da7439196b12dc342c78b4b35eb99f54889d41c84',
    },
    revision: 1,
    label: '李之之',
    url: '/publication-art/li_zhizhi.ac24f546f928edb2.webp',
    sha256: 'ac24f546f928edb2048c8f9f2afb3cbb1312169193f1967b880ed735ef553324',
    uses: ['avatar'],
  },
  {
    key: 'shu_yating',
    scenePortrait: {
      url: '/publication-art/scene-shu_yating.3c10ff0e265ee299.png',
      sha256: '3c10ff0e265ee29976ff2b650f3fde0dbf04b33a3f20468127938d4852c42eff',
    },
    revision: 1,
    label: '舒雅婷',
    url: '/publication-art/shu_yating.0c1380e8cc45cd7a.webp',
    sha256: '0c1380e8cc45cd7a6d5fc411b5bae191e2ae60501f6def80ad676f7737dbd1cf',
    uses: ['avatar'],
  },
  {
    key: 'xinxin',
    scenePortrait: {
      url: '/publication-art/scene-xinxin.ab0f08e16b6c00f1.png',
      sha256: 'ab0f08e16b6c00f179d013f319fb80ea9d44c94a8b0b53c3a65a41e447de36e9',
    },
    revision: 1,
    label: '欣欣',
    url: '/publication-art/xinxin.bbddc2d7dcc9e726.webp',
    sha256: 'bbddc2d7dcc9e7263ad1c5733dcc1b198cd46dd7dfb4471e1a81fa51d37d8ceb',
    uses: ['avatar'],
  },
  {
    key: 'laowang',
    revision: 1,
    label: '老王',
    url: '/publication-art/laowang.34579c94535262f0.webp',
    sha256: '34579c94535262f0361583a12b41b7c6ccb146625a475f08d0d1b6813eda3765',
    uses: ['avatar'],
  },
  {
    key: 'mother',
    revision: 1,
    label: '妈妈',
    url: '/publication-art/mother.c98687bdf83b67fe.webp',
    sha256: 'c98687bdf83b67fe9fecf2f240ee43e7f55b56b78ae9b88da86123db27860bca',
    uses: ['avatar'],
  },
  {
    key: 'cover',
    revision: 1,
    label: '分手之后 · 创作封面',
    url: '/publication-art/cover.fcd369cd55ba2c55.webp',
    sha256: 'fcd369cd55ba2c5550d06add55ebafc7b99ba5023061c96cff971939d37af098',
    uses: ['cover'],
  },
];
export function publicationArt(raw: unknown, use: 'avatar' | 'cover'): PublicationArt | null {
  const own = (o: unknown, k: string): unknown => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return undefined;
    const p = Object.getPrototypeOf(o);
    if (p !== Object.prototype && p !== null) return undefined;
    const d = Object.getOwnPropertyDescriptor(o, k);
    return d && 'value' in d ? d.value : undefined;
  };
  const asset = own(raw, 'asset'),
    visibility = own(raw, 'visibility'),
    url = own(raw, 'url'),
    depiction = own(raw, 'depiction');
  if (
    own(asset, 'namespace') !== 'publication' ||
    own(raw, 'use') !== use ||
    own(visibility, 'kind') !== 'world'
  )
    return null;

  if (typeof url === 'string' && url) {
    return {
      key: typeof own(asset, 'key') === 'string' ? (own(asset, 'key') as string) : 'custom',
      revision: typeof own(asset, 'revision') === 'number' ? (own(asset, 'revision') as number) : 1,
      label: typeof own(raw, 'label') === 'string' ? (own(raw, 'label') as string) : '自定义图片',
      url,
      sha256: 'custom_' + (typeof own(raw, 'key') === 'string' ? own(raw, 'key') : 'art'),
      uses: [use],
    };
  }

  if (depiction !== 'generated_image') return null;

  return (
    PUBLICATION_ART.find(
      (a) =>
        a.key === own(asset, 'key') &&
        a.revision === own(asset, 'revision') &&
        a.uses.includes(use),
    ) ?? null
  );
}
