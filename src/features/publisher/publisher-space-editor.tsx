'use client';

import { useRef, useState } from 'react';
import {
  addEmptyPlace,
  removePlace,
  attachPlaceImage,
  detachPlaceImage,
  placeImageUrl,
  type UploadedSceneImage,
} from './publisher-place-image.ts';
import s from './publisher-space-editor.module.css';

type Row = Record<string, unknown>;

export function PublisherSpaceEditor({
  content,
  disabled,
  onChange,
  uploadSceneImage,
  previewSceneImage,
  workId,
}: {
  content: Record<string, unknown>;
  disabled: boolean;
  onChange: (content: Record<string, unknown>) => void;
  uploadSceneImage?: (file: File) => Promise<UploadedSceneImage>;
  previewSceneImage?: (assetId: string) => string;
  workId?: string;
}) {
  const [uploadingPlace, setUploadingPlace] = useState<string | null>(null);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const targetPlace = useRef<string | null>(null);
  const currentContent = useRef(content);
  currentContent.current = content;
  const currentWorkId = useRef(workId);
  currentWorkId.current = workId;

  if (content.places !== undefined && !Array.isArray(content.places))
    return <p>原有地点需要核对，已保留原稿。</p>;
  const places = (content.places ?? []) as Row[];
  if (places.some((place) => !place || typeof place !== 'object' || Array.isArray(place)))
    return <p>原有地点需要核对，已保留原稿。</p>;

  const updatePlace = (index: number, patch: Row) => {
    if (disabled || uploadingPlace) return;
    onChange({
      ...content,
      places: places.map((place, position) =>
        position === index ? { ...place, ...patch } : place,
      ),
    });
  };
  const upload = async (file: File | undefined) => {
    const placeKey = targetPlace.current;
    targetPlace.current = null;
    if (!file || !placeKey || disabled) return;
    if (!uploadSceneImage) return setError('暂时无法上传图片，请刷新后重试。');
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 10_000_000 ||
      !file.size
    )
      return setError('请选择不超过 10 MB 的 JPG、PNG 或 WebP 图片。');
    setUploadingPlace(placeKey);
    setError('');
    const uploadWorkId = workId;
    try {
      const uploaded = await uploadSceneImage(file);
      if (currentWorkId.current !== uploadWorkId) return;
      onChange(attachPlaceImage(currentContent.current, placeKey, uploaded));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '图片未添加成功，请重试。');
    } finally {
      setUploadingPlace(null);
    }
  };

  return (
    <section className={s.card} aria-label="地点编辑">
      <div className={s.header}>
        <h3>地点</h3>
        <p>写下故事会出现的地点；场景图可以之后再加。</p>
      </div>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <input
        ref={fileInput}
        className={s.hiddenInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="选择地点场景图"
        disabled={disabled || !!uploadingPlace}
        onChange={(event) => {
          const file = event.target.files?.[0];
          void upload(file);
          event.target.value = '';
        }}
      />
      <div className={s.list}>
        {places.map((place, index) => {
          const key = String(place.key ?? index);
          const imageUrl = placeImageUrl(content, place, previewSceneImage);
          const sceneImage = place.sceneImage;
          const hasImage =
            (typeof place.sceneMediaKey === 'string' && !!place.sceneMediaKey) ||
            (!!sceneImage &&
              typeof sceneImage === 'object' &&
              !Array.isArray(sceneImage) &&
              typeof (sceneImage as Row).assetId === 'string');
          return (
            <article className={s.place} key={key}>
              <div className={s.mainRow}>
                <label className={s.nameField}>
                  地点 {index + 1}
                  <input
                    value={typeof place.name === 'string' ? place.name : ''}
                    maxLength={100}
                    disabled={disabled || !!uploadingPlace}
                    onChange={(event) => updatePlace(index, { name: event.target.value })}
                    placeholder="例如：街角咖啡店"
                  />
                </label>
                <div className={s.imageField}>
                  {imageUrl ? (
                    <img src={imageUrl} alt={`${String(place.name || '地点')}的场景图`} />
                  ) : (
                    <span>{hasImage ? '已添加场景图' : '场景图选填'}</span>
                  )}
                </div>
                <div className={s.actions}>
                  <button
                    type="button"
                    disabled={disabled || !!uploadingPlace || !uploadSceneImage}
                    onClick={() => {
                      targetPlace.current = key;
                      fileInput.current?.click();
                    }}
                  >
                    {uploadingPlace === key ? '上传中…' : hasImage ? '替换图片' : '添加图片'}
                  </button>
                  {hasImage && (
                    <button
                      type="button"
                      disabled={disabled || !!uploadingPlace}
                      onClick={() => {
                        try {
                          onChange(detachPlaceImage(content, key));
                          setError('');
                        } catch (cause) {
                          setError(cause instanceof Error ? cause.message : '请刷新后重试。');
                        }
                      }}
                    >
                      取消图片
                    </button>
                  )}
                </div>
              </div>
              <div className={s.actions}>
                <button
                  type="button"
                  disabled={disabled || !!uploadingPlace || places.length <= 1}
                  title={places.length <= 1 ? '至少要保留 1 个地点。' : '删除这个地点'}
                  onClick={() => {
                    const label = String(place.name || `地点 ${index + 1}`);
                    if (!window.confirm(`删除地点「${label}」？`)) return;
                    try {
                      onChange(removePlace(content, key));
                      setError('');
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : '请刷新后重试。');
                    }
                  }}
                >
                  删除地点
                </button>
              </div>
              <details className={s.details}>
                <summary>场所说明（选填）</summary>
                <label>
                  <span className={s.visuallyHidden}>场所说明</span>
                  <textarea
                    value={typeof place.description === 'string' ? place.description : ''}
                    maxLength={800}
                    rows={3}
                    disabled={disabled || !!uploadingPlace}
                    onChange={(event) => updatePlace(index, { description: event.target.value })}
                    placeholder="有需要再补充场景特点。"
                  />
                </label>
              </details>
            </article>
          );
        })}
      </div>
      <button
        type="button"
        className={s.addButton}
        disabled={disabled || !!uploadingPlace || places.length >= 24}
        onClick={() => {
          try {
            onChange(addEmptyPlace(content));
            setError('');
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '请刷新后重试。');
          }
        }}
      >
        ＋ 添加地点
      </button>
    </section>
  );
}
