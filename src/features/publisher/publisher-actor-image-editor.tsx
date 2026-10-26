'use client';
import { useEffect, useRef, useState } from 'react';
import type { PublisherClient } from './publisher-client.ts';
import type { PublisherStageImageRecord } from '../../contracts/publisher-stage-image.ts';
import { actorStageImageId, attachActorImage, detachActorImage } from './publisher-actor-image.ts';
import type { UploadedSceneImage } from './publisher-place-image.ts';
import s from './publisher-workbench.module.css';

/** Author-only image preparation. Applying a candidate never changes world presence. */
export function PublisherActorImageEditor({
  content,
  actorKey,
  workId,
  disabled,
  uploadImage,
  onChange,
  generationClient,
  draftVersion,
}: {
  generationClient?: PublisherClient;
  draftVersion?: number;
  content: Record<string, unknown>;
  actorKey: string;
  workId: string;
  disabled: boolean;
  uploadImage?: (file: File) => Promise<UploadedSceneImage>;
  onChange: (content: Record<string, unknown>) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileMode = useRef<'upload' | 'generate'>('upload');
  const [generation, setGeneration] = useState<PublisherStageImageRecord | null>(null);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [generationId, setGenerationId] = useState<string>();
  const generationKey = 'pl-stage-generation:' + workId + ':' + actorKey;
  useEffect(() => {
    try {
      setGenerationId(sessionStorage.getItem(generationKey) ?? undefined);
    } catch {}
  }, [generationKey]);
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
  async function produce(file?: File) {
    if (
      !file ||
      disabled ||
      uploading ||
      generationBusy ||
      !uploadImage ||
      !generationClient ||
      draftVersion === undefined
    )
      return;
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      !file.size ||
      file.size > 10_000_000
    ) {
      setError('请选择不超过10 MB的人物照片。');
      return;
    }
    const target = { workId, actorKey };
    const stillHere = () =>
      mounted.current &&
      current.current.workId === target.workId &&
      current.current.actorKey === target.actorKey;
    setGenerationBusy(true);
    setError('');
    try {
      const source = await uploadImage(file);
      if (!stillHere()) return;
      const commandId = crypto.randomUUID();
      setGenerationId(commandId);
      try {
        sessionStorage.setItem(generationKey, commandId);
      } catch {}
      const result = await generationClient.makeStageImage(target.workId, {
        commandId,
        expectedDraftVersion: draftVersion,
        actorKey: target.actorKey,
        sourceAssetId: source.assetId,
      });
      if (stillHere()) setGeneration(result);
    } catch (cause) {
      if (stillHere())
        setError(
          cause instanceof Error
            ? cause.message
            : '制作结果暂未确认，请核对原结果，不必再次付费制作。',
        );
    } finally {
      if (stillHere()) setGenerationBusy(false);
    }
  }
  async function checkGeneration() {
    if (!generationId || !generationClient || generationBusy) return;
    const target = { workId, actorKey };
    setGenerationBusy(true);
    setError('');
    try {
      const result = await generationClient.readStageImage(workId, generationId);
      if (
        mounted.current &&
        current.current.workId === target.workId &&
        current.current.actorKey === target.actorKey
      )
        setGeneration(result);
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : '暂时未能核对，请稍后重试。');
    } finally {
      if (mounted.current) setGenerationBusy(false);
    }
  }
  return (
    <details className={s.formFieldFull}>
      <summary className={s.fieldLabel}>现场形象（选填）{assetId ? ' · 已添加' : ''}</summary>
      <p>
        用于现场人物展示，不替换微信头像。可以上传普通人物照片制作现场形象，也可以直接上传现成形象。原照片和微信头像都会保留。
      </p>
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
      {generationClient ? (
        <button
          type="button"
          className={`${s.btn} ${s.btnPrimary}`}
          disabled={
            disabled || uploading || generationBusy || !uploadImage || draftVersion === undefined
          }
          onClick={() => {
            fileMode.current = 'generate';
            fileInput.current?.click();
          }}
        >
          {generationBusy ? '正在制作现场形象…' : '上传照片制作形象'}
        </button>
      ) : null}
      {generationClient ? (
        <p>请先保存人物资料。制作完成后可预览，再选择使用；核对原结果不会再次生图。</p>
      ) : null}
      <button
        type="button"
        className={`${s.btn} ${s.btnSecondary}`}
        disabled={disabled || uploading || generationBusy || !uploadImage}
        onClick={() => {
          fileMode.current = 'upload';
          fileInput.current?.click();
        }}
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
          void (fileMode.current === 'generate' ? produce(file) : upload(file));
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
      {generationId && generationClient ? (
        <button
          type="button"
          className={`${s.btn} ${s.btnSecondary}`}
          disabled={generationBusy || disabled}
          onClick={() => void checkGeneration()}
        >
          核对制作结果
        </button>
      ) : null}
      {generation?.image ? (
        <div>
          <img
            src={`/api/v1/publisher/works/${workId}/media/${generation.image.assetId}`}
            alt="新制作的现场形象候选"
            style={{
              display: 'block',
              width: 160,
              maxWidth: '100%',
              maxHeight: 260,
              objectFit: 'contain',
              background: '#142333',
              marginBlock: 12,
            }}
          />
          <button
            type="button"
            className={`${s.btn} ${s.btnPrimary}`}
            disabled={disabled || generationBusy}
            onClick={() => {
              if (!generation.image) return;
              onChange(
                attachActorImage(current.current.content, actorKey, {
                  assetId: generation.image.assetId,
                  kind: 'image',
                }),
              );
              try {
                sessionStorage.removeItem(generationKey);
              } catch {}
              setGenerationId(undefined);
              setGeneration(null);
            }}
          >
            使用这张现场形象
          </button>
        </div>
      ) : generation ? (
        <p role="status">
          {generation.status === 'running'
            ? '这次制作仍在处理中，可以稍后核对。'
            : generation.status === 'unknown'
              ? '本次结果尚未确认，已保留原请求；请先核对，不要重复制作。'
              : '这次制作尚未得到可用形象。可以核对已保留的处理结果，原图和已有形象未改变。'}
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </details>
  );
}
