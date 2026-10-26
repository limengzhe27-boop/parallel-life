'use client';
import { useEffect, useRef, useState } from 'react';
import { actorStageImageId, attachActorImage, detachActorImage } from './publisher-actor-image.ts';
import type { UploadedSceneImage } from './publisher-place-image.ts';
import s from './publisher-workbench.module.css';

/** Author image upload only. It neither generates a photo nor puts anyone into a scene. */
export function PublisherActorImageEditor({
  content,
  actorKey,
  workId,
  disabled,
  uploadImage,
  onChange,
}: {
  content: Record<string, unknown>;
  actorKey: string;
  workId: string;
  disabled: boolean;
  uploadImage?: (file: File) => Promise<UploadedSceneImage>;
  onChange: (content: Record<string, unknown>) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [error, setError] = useState('');
  const current = useRef({ content, workId, actorKey });
  current.current = { content, workId, actorKey };
  const [failedImage, setFailedImage] = useState<string>();
  const assetId = actorStageImageId(content, actorKey);
  const imageUrl = assetId
    ? `/api/v1/publisher/works/${encodeURIComponent(workId)}/media/${encodeURIComponent(assetId)}`
    : undefined;
  async function upload(file?: File) {
    if (!file || disabled || uploading || !uploadImage) return;
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size < 1 ||
      file.size > 10_000_000
    ) {
      setError('请选择不超过 10 MB 的 JPG、PNG 或 WebP 图片。');
      return;
    }
    const target = { workId, actorKey };
    setUploading(true);
    setError('');
    try {
      const result = await uploadImage(file);
      // A slow upload cannot overwrite another work/person or edits made meanwhile.
      if (
        !mounted.current ||
        current.current.workId !== target.workId ||
        current.current.actorKey !== target.actorKey
      )
        return;
      onChange(attachActorImage(current.current.content, target.actorKey, result));
    } catch (cause) {
      if (
        mounted.current &&
        current.current.workId === target.workId &&
        current.current.actorKey === target.actorKey
      )
        setError(cause instanceof Error ? cause.message : '图片未添加成功，请重试。');
    } finally {
      if (mounted.current) setUploading(false);
    }
  }
  return (
    <details className={s.formFieldFull}>
      <summary className={s.fieldLabel}>现场形象（选填）{assetId ? ' · 已添加' : ''}</summary>
      <p>用于现场人物展示，不替换微信头像。上传准备好的形象图片，保存草稿后用于试演和后续发布。</p>
      {imageUrl && failedImage !== imageUrl ? (
        <img
          src={imageUrl}
          alt="现场人物形象预览"
          onError={() => setFailedImage(imageUrl)}
          style={{
            display: 'block',
            maxWidth: '100%',
            width: 160,
            maxHeight: 240,
            objectFit: 'contain',
            marginBottom: 8,
          }}
        />
      ) : assetId ? (
        <p>图片暂时无法预览，已保留原引用。</p>
      ) : null}
      <button
        type="button"
        className={`${s.btn} ${s.btnSecondary}`}
        disabled={disabled || uploading || !uploadImage}
        onClick={() => fileInput.current?.click()}
      >
        {uploading ? '正在上传…' : assetId ? '更换形象图片' : '上传形象图片'}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="上传现场人物形象"
        disabled={disabled || uploading || !uploadImage}
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          void upload(file);
        }}
      />
      {assetId ? (
        <button
          type="button"
          className={`${s.btn} ${s.btnSecondary}`}
          disabled={disabled || uploading}
          onClick={() => {
            setError('');
            onChange(detachActorImage(content, actorKey));
          }}
        >
          移除现场形象
        </button>
      ) : null}
      {!uploadImage ? <p>图片上传暂时不可用，已有形象仍保留。</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </details>
  );
}
