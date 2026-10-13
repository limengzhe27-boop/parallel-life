'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { PUBLICATION_ART } from '../../contracts/publication-assets.ts';
import { publisherArtUrl, selectPublisherArt } from './publisher-art-model.ts';
import { publicationLocalTime, publicationUtcTime } from './publisher-story-time.ts';
import { PublisherPlotEditor } from './publisher-plot-editor.tsx';
import { PublisherImportDialog } from './publisher-import-dialog.tsx';
import { PublisherSpaceEditor } from './publisher-space-editor.tsx';
import { PublisherOpeningEditor } from './publisher-opening-editor.tsx';
import type { ImportSummary } from './publisher-importer.ts';
import {
  patchPlotField,
  plotChoices,
  plotRecord,
  plotRows,
  plotRowEditable,
} from './publisher-plot-model.ts';
import { PublisherDraftContentSchema } from '../../contracts/world-publisher.ts';
import type { PublisherWorkbenchProps } from '../../contracts/publisher-workbench.ts';
import {
  parseActorEditor,
  updateActorInContent,
  createEmptyActor,
  checkActorDeletionSafety,
  deleteActorFromContent,
  parseWorldSettings,
  parsePlotData,
  updateWorldSettingsInContent,
  isDraftDirty,
  deepClone,
  type ActorEditorForm,
  type WorldSettingsForm,
} from './publisher-editor.ts';
import s from './publisher-workbench.module.css';

type MainTab = 'settings' | 'actors' | 'plot';

function issueLabel(path: readonly (string | number)[], code: string) {
  if (code === 'trial_unverified') return '请先试演，并完成一条真实的角色对话，再重新检查。';
  if (code === 'media_unverified') return '素材尚未核验，请检查所选图片后再试。';
  const hints: Record<string, string> = {
    future_opening_message: '发送时间不能晚于世界开场。',
    history_message_not_past: '过去的对话应发生在世界开场之前。',
    sender_not_player_known: '请选择开场时玩家已认识的人物，或先完善人物的开场关系。',
    space_route_budget: '当前单段路线支持最多 120 分钟，请调整路线或拆成多段。',
  };
  const fields: Record<string, string> = {
    title: '名称',
    hook: '一句话吸引点',
    description: '说明',
    experienceNote: '体验说明',
    publicSetting: '公开世界设定',
    hiddenContext: '幕后世界设定',
    tone: '叙事氛围',
    startAt: '开场日期与时间',
    startPlaceKey: '开场地点',
    identity: '身份',
    situation: '主角当前处境',
    name: '姓名或地点名称',
    background: '人物背景',
    voice: '说话方式',
    motivation: '人物动机',
    boundaries: '人物边界',
    at: '发生时间',
    origin: '消息来源',
    intent: '事件运行方式',
    editorialIntent: '剧情说明',
    minutes: '移动耗时',
    fromPlaceKey: '出发地点',
    toPlaceKey: '到达地点',
  };
  const groups: Record<string, string> = {
    actors: '人物',
    places: '地点',
    candidates: '可选事件',
    routes: '路线',
    history: '已发生事实',
    phone: '开场手机内容',
    timeline: '阶段与时间线',
  };
  const opening = path[0] === 'phone' && path[1] === 'messages';
  const group = opening ? '开场消息' : (groups[String(path[0])] ?? '');
  const rowIndex = opening ? path[2] : path[1];
  const row = typeof rowIndex === 'number' ? `第 ${rowIndex + 1} ${opening ? '条' : '项'}` : '';
  const field = fields[String(path[path.length - 1])] ?? (group ? '设定' : '世界内容');
  const reason =
    hints[code] ??
    (code === 'too_small'
      ? '请补充完整内容'
      : code === 'too_big'
        ? '内容过长，请精简后重试'
        : code === 'invalid_format'
          ? '请检查填写格式'
          : code === 'unrecognized_keys'
            ? '有暂不支持的字段，请按填写示例调整'
            : '请核对内容与引用是否完整一致');
  return `${group}${row}${group ? ' · ' : ''}${field}：${reason}`;
}

export function PublisherWorkbench(props: PublisherWorkbenchProps) {
  const session = props.session;
  const {
    works,
    work,
    check,
    busy,
    error,
    onSelectWork,
    onCreateWork,
    onSaveDraft,
    onCheck,
    onTrial,
    onPublish,
    onLogout,
  } = props;

  // Active main tab
  const [activeTab, setActiveTab] = useState<MainTab>('actors');

  // Local working draft: initialized from props.work, retained upon server errors or user edits
  const [draftTitle, setDraftTitle] = useState(() => work?.title ?? '');
  const [draftContent, setDraftContent] = useState<Record<string, unknown>>(() =>
    work?.draft?.content ? deepClone(work.draft.content) : {},
  );
  const [selectedActorKey, setSelectedActorKey] = useState<string | null>(() => {
    const rawActors = work?.draft?.content?.actors;
    if (Array.isArray(rawActors) && rawActors.length > 0) {
      const first = rawActors[0] as Record<string, unknown>;
      return typeof first?.key === 'string' ? first.key : null;
    }
    return null;
  });

  // Track the baseline version corresponding to currently loaded props.work
  const [loadedWorkId, setLoadedWorkId] = useState<string | null>(() => work?.id ?? null);
  const [loadedDraftVersion, setLoadedDraftVersion] = useState<number | null>(
    () => work?.draft?.version ?? null,
  );

  // Status message notice
  const [notice, setNotice] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);

  // Deletion confirmation warning dialog state
  const [deletionWarning, setDeletionWarning] = useState<{
    actorKey: string;
    actorName: string;
    references: Array<{ category: string; key: string; label: string }>;
  } | null>(null);

  // Modal for creating new work
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWorkTitle, setNewWorkTitle] = useState('');
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [showMarkdownImport, setShowMarkdownImport] = useState(false);
  const [markdownReview, setMarkdownReview] = useState<ImportSummary>();

  // Sync state when props.work updates or changes workId/draftVersion
  useEffect(() => {
    if (!work) {
      setDraftTitle('');
      setDraftContent({});
      setSelectedActorKey(null);
      setLoadedWorkId(null);
      setLoadedDraftVersion(null);
      return;
    }

    const isNewWork = work.id !== loadedWorkId;
    const isNewVersion = work.draft.version !== loadedDraftVersion;

    if (isNewWork || isNewVersion) {
      setShowMarkdownImport(false);
      if (isNewWork) setMarkdownReview(undefined);
      setDraftTitle(work.title);
      setDraftContent(deepClone(work.draft.content));
      setImportText('');
      setImportError('');
      setLoadedWorkId(work.id);
      setLoadedDraftVersion(work.draft.version);

      // Auto-select first actor if available
      const actors = Array.isArray(work.draft.content.actors)
        ? (work.draft.content.actors as Array<{ key?: string }>)
        : [];
      if (isNewWork || !selectedActorKey) {
        setSelectedActorKey(actors[0]?.key ?? null);
      }
    }
  }, [work, loadedWorkId, loadedDraftVersion, selectedActorKey]);

  // Derived saved baseline for dirty checking
  const savedState = useMemo(() => {
    if (!work) return null;
    return {
      title: work.title,
      content: work.draft.content,
    };
  }, [work]);

  // Check if draft has unsaved changes
  const isDirty = useMemo(() => {
    return (
      importText.length > 0 ||
      isDraftDirty(savedState, { title: draftTitle, content: draftContent })
    );
  }, [savedState, draftTitle, draftContent, importText]);

  useEffect(() => {
    if (!isDirty) return;
    const protect = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [isDirty]);

  // Actors list extracted from working draftContent
  const actorList = useMemo(() => {
    if (!Array.isArray(draftContent.actors)) return [];
    return (draftContent.actors as Record<string, unknown>[]).filter(
      (a): a is Record<string, unknown> & { key: string; name: string } =>
        Boolean(a && typeof a.key === 'string'),
    );
  }, [draftContent.actors]);

  // Active actor form
  const currentActorForm = useMemo<ActorEditorForm | null>(() => {
    if (!selectedActorKey) return null;
    const found = actorList.find((a) => a.key === selectedActorKey);
    if (!found) return null;
    return parseActorEditor(found, draftContent);
  }, [selectedActorKey, actorList, draftContent]);

  // World settings form
  const worldSettings = useMemo<WorldSettingsForm>(() => {
    return parseWorldSettings(draftContent, draftTitle);
  }, [draftContent, draftTitle]);

  const plotData = useMemo(() => parsePlotData(draftContent), [draftContent]);

  // Handle actor field edits
  const handleActorChange = useCallback(
    (field: keyof ActorEditorForm, value: unknown) => {
      if (!currentActorForm) return;
      const key = currentActorForm.key;
      setDraftContent((previous) => {
        const records = Array.isArray(previous.actors) ? previous.actors : [];
        const record = records.find((row: Record<string, unknown>) => row?.key === key);
        if (!record) return previous;
        if (field === 'knownAtStart') {
          if (typeof value !== 'boolean') return previous;
          return {
            ...previous,
            actors: records.map((row: Record<string, unknown>) =>
              row === record ? { ...row, knownAtStart: value } : row,
            ),
          };
        }
        const updatedForm: ActorEditorForm = {
          ...parseActorEditor(record, previous),
          [field]: value,
        };
        return updateActorInContent(previous, updatedForm);
      });
    },
    [currentActorForm, draftContent],
  );

  // Handle world settings edits
  const handleArtChange = (use: 'avatar' | 'cover', key: string) => {
    if (!session.canEdit || busy) return;
    try {
      setDraftContent(selectPublisherArt(draftContent, use, key, currentActorForm?.key));
    } catch {
      setNotice({
        type: 'error',
        message: '这份素材暂时不能使用，请检查是否有重复或冲突的素材引用。',
      });
    }
  };
  const handleWorldSettingsChange = useCallback(
    (field: keyof WorldSettingsForm, value: string) => {
      if (field === 'title') {
        setDraftTitle(value);
      }
      setDraftContent((previous) =>
        updateWorldSettingsInContent(previous, {
          ...parseWorldSettings(previous, draftTitle),
          [field]: value,
        }),
      );
    },
    [worldSettings, draftContent],
  );

  // Add new actor
  const handleAddActor = useCallback(() => {
    const existingKeys = actorList.map((a) => a.key);
    const newActor = createEmptyActor(existingKeys);
    newActor.name = `新人物 ${existingKeys.length + 1}`;
    const nextContent = updateActorInContent(draftContent, newActor);
    setDraftContent(nextContent);
    setSelectedActorKey(newActor.key);
  }, [actorList, draftContent]);

  // Delete actor button clicked
  const handleDeleteActorRequest = useCallback(() => {
    if (!currentActorForm) return;
    const safety = checkActorDeletionSafety(draftContent, currentActorForm.key);
    if (!safety.canDelete) {
      setDeletionWarning({
        actorKey: currentActorForm.key,
        actorName: currentActorForm.name,
        references: safety.references,
      });
      return;
    }
    // Safe to delete immediately
    const nextContent = deleteActorFromContent(draftContent, currentActorForm.key);
    setDraftContent(nextContent);
    const remaining = actorList.filter((a) => a.key !== currentActorForm.key);
    setSelectedActorKey(remaining[0]?.key ?? null);
    setNotice({ type: 'success', message: `已移除人物「${currentActorForm.name}」` });
  }, [currentActorForm, draftContent, actorList]);

  // Save draft
  const handleSaveDraft = useCallback(() => {
    if (!work) return;
    if (importText) {
      setImportError('请先应用或清空导入的内容，再保存草稿。');
      return;
    }
    if (!session.canEdit) {
      setNotice({ type: 'error', message: '权限不足：当前账号未被授予编辑作品权限。' });
      return;
    }
    setNotice(null);
    onSaveDraft({
      title: draftTitle,
      content: draftContent,
    });
  }, [work, session.canEdit, draftTitle, draftContent, onSaveDraft, importText]);

  // Create work
  const handleCreateWorkSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!newWorkTitle.trim()) return;
      onCreateWork({
        title: newWorkTitle.trim(),
        content: {
          schemaVersion: 1,
          work: {
            key: 'work_' + crypto.randomUUID().replaceAll('-', '').slice(0, 24),
            title: newWorkTitle.trim(),
            hook: '',
            description: '',
            experienceNote: '',
          },
          world: {
            publicSetting: '',
            tone: '',
            startAt: '',
            startPlaceKey: 'place_home',
            hiddenContext: '',
          },
          protagonist: {
            identity: '',
            situation: '',
            knownFactKeys: [],
          },
          actors: [],
          relationships: [],
          places: [{ key: 'place_home', name: '起点住处', description: '', knownAtStart: true }],
          routes: [],
          history: [],
          initialKnowledge: [],
          phone: { messages: [], notes: [], invitations: [], album: [] },
          media: [],
          candidates: [],
          extensions: [],
        },
      });
      setShowCreateModal(false);
      setNewWorkTitle('');
    },
    [newWorkTitle, onCreateWork],
  );

  // Switch work selection with dirty prevention
  const handleSelectWorkSafe = useCallback(
    (targetWorkId: string) => {
      if (isDirty && work) {
        const confirmed = window.confirm(
          '当前作品有未保存的编辑内容，切换后未保存草稿将被放弃，是否继续？',
        );
        if (!confirmed) return;
      }
      onSelectWork(targetWorkId);
    },
    [isDirty, work, onSelectWork],
  );

  // Avatar helper
  const getAvatarChar = (name: string) => {
    const trimmed = name.trim();
    return trimmed ? trimmed[0] : '人';
  };

  return (
    <div className={s.workbench}>
      {/* ================= Left Sidebar (Works) ================= */}
      <aside className={s.sidebar} aria-label="作品导航">
        <div>
          <div className={s.brand}>
            <h1 className={s.brandTitle}>如果 内容后台</h1>
            <p className={s.brandSub}>世界创作与发布管理</p>
          </div>

          <div className={s.sectionHeading}>我的世界</div>
          <nav className={s.workList} aria-label="世界作品列表">
            {works.length === 0 ? (
              <p className={s.configNotice}>暂无已创建的世界作品</p>
            ) : (
              works.map((w) => {
                const isActive = work?.id === w.id;
                return (
                  <button
                    key={w.id}
                    type="button"
                    className={`${s.workItem} ${isActive ? s.active : ''}`}
                    onClick={() => handleSelectWorkSafe(w.id)}
                    aria-current={isActive ? 'page' : undefined}
                    disabled={busy}
                  >
                    <span className={s.workIcon} aria-hidden="true">
                      📄
                    </span>
                    <span
                      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {w.title}
                    </span>
                  </button>
                );
              })
            )}
          </nav>
        </div>

        <div className={s.sidebarFooter}>
          <button
            type="button"
            className={s.newWorkButton}
            onClick={() => setShowCreateModal(true)}
            disabled={busy || !session.canEdit}
          >
            + 新建世界
          </button>
          <p className={s.configNotice}>登录身份：{session.displayName}</p>
          <button
            type="button"
            className={s.btnLogout}
            disabled={busy}
            onClick={() => {
              if (!isDirty || window.confirm('还有未保存的修改，确认退出并放弃吗？')) onLogout();
            }}
          >
            退出登录
          </button>
        </div>
      </aside>

      {/* ================= Main Area ================= */}
      <main className={s.main}>
        {/* Top bar */}
        <header className={s.topbar}>
          <div className={s.topbarMeta}>
            <div className={s.titleArea}>
              <div className={s.breadcrumb}>
                世界 / {work ? draftTitle || work.title : '未选择作品'}
              </div>
              <div className={s.titleRow}>
                <h2 className={s.workTitle}>
                  {work ? draftTitle || work.title : '请在左侧选择或新建世界'}
                </h2>
                {work && (
                  <span
                    className={`${s.statusBadge} ${
                      work.status === 'published'
                        ? s.statusPublished
                        : work.status === 'unpublished'
                          ? s.statusUnpublished
                          : s.statusDraft
                    }`}
                  >
                    {work.status === 'published'
                      ? `已上架 v${work.publicationVersion ?? 1}`
                      : work.status === 'unpublished'
                        ? '已下架'
                        : `草稿 r${work.draft.version}`}
                  </span>
                )}
                {isDirty && <span className={s.dirtyFlag}>（存在未保存修改）</span>}
              </div>
            </div>

            {/* Actions Row */}
            {work && (
              <div className={s.actionsRow}>
                <button
                  type="button"
                  className={`${s.btn} ${s.btnSecondary}`}
                  onClick={handleSaveDraft}
                  disabled={busy || !session.canEdit || !isDirty}
                  title={
                    !session.canEdit
                      ? '您没有编辑权限'
                      : !isDirty
                        ? '草稿无未保存变更'
                        : '保存当前草稿'
                  }
                >
                  {busy ? '正在保存…' : '保存草稿'}
                </button>

                <button
                  type="button"
                  className={`${s.btn} ${s.btnSecondary}`}
                  onClick={onCheck}
                  disabled={busy || isDirty}
                  title="检查已保存的草稿，请先保存修改"
                >
                  检查
                </button>

                <button
                  type="button"
                  className={`${s.btn} ${s.btnSecondary}`}
                  disabled={busy || !session.canEdit}
                  onClick={() => setShowMarkdownImport(true)}
                >
                  导入 Markdown
                </button>

                <button
                  type="button"
                  className={`${s.btn} ${s.btnTrial}`}
                  onClick={onTrial ? () => onTrial() : undefined}
                  disabled={busy || isDirty || !onTrial}
                  title={!onTrial ? '试演功能待后端接口接通' : '在手机沙盒中试演当前草稿'}
                >
                  {onTrial ? '试演' : '试演 (未接通)'}
                </button>

                <button
                  type="button"
                  className={`${s.btn} ${s.btnPublish}`}
                  onClick={onPublish ? () => onPublish() : undefined}
                  disabled={
                    busy ||
                    !onPublish ||
                    !session.canPublish ||
                    isDirty ||
                    check?.status !== 'ready' ||
                    check.workId !== work.id ||
                    check.draftVersion !== work.draftVersion ||
                    check.contentHash !== work.draft.contentHash ||
                    !check.trialVerified ||
                    !check.mediaVerified
                  }
                  title={
                    !onPublish
                      ? '发布功能待后端接口接通'
                      : !session.canPublish
                        ? '您没有发布权限'
                        : isDirty
                          ? '请先保存草稿'
                          : check?.status !== 'ready'
                            ? '检查未通过，尚不可发布'
                            : '将当前草稿发布上架'
                  }
                >
                  {onPublish ? '发布' : '发布 (未接通)'}
                </button>
              </div>
            )}
          </div>

          {/* Three Main Tabs */}
          {work && (
            <div className={s.tabsRow} role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'settings'}
                className={`${s.tabButton} ${activeTab === 'settings' ? s.activeTab : ''}`}
                onClick={() => setActiveTab('settings')}
              >
                世界设定
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'actors'}
                className={`${s.tabButton} ${activeTab === 'actors' ? s.activeTab : ''}`}
                onClick={() => setActiveTab('actors')}
              >
                人物
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'plot'}
                className={`${s.tabButton} ${activeTab === 'plot' ? s.activeTab : ''}`}
                onClick={() => setActiveTab('plot')}
              >
                剧情
              </button>
            </div>
          )}
        </header>

        {/* Global Feedback Banners */}
        {markdownReview && (
          <details className={s.banner}>
            <summary>
              本次文稿导入记录 · {markdownReview.actors.length} 位人物、
              {markdownReview.candidatesCount} 个候选
            </summary>
            <p>此记录仅供当前编辑时核对，不自动保存为世界事实或公开资料。原始文档保持原样。</p>
            <ul>
              {markdownReview.diagnostics.map((item, index) => (
                <li key={index}>
                  {item.filename}：{item.message}
                </li>
              ))}
            </ul>
            {markdownReview.unmapped.map((item, index) => (
              <details key={index}>
                <summary>
                  {item.filename} · {item.reason}
                </summary>
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {item.content}
                </pre>
              </details>
            ))}
          </details>
        )}
        {error && (
          <div className={`${s.banner} ${s.bannerError}`} role="alert">
            <span>
              <strong>操作失败 [{error.code}]：</strong> {error.message}
            </span>
          </div>
        )}
        {notice && (
          <div
            className={`${s.banner} ${
              notice.type === 'error'
                ? s.bannerError
                : notice.type === 'warning'
                  ? s.bannerWarning
                  : s.bannerSuccess
            }`}
            role="status"
          >
            <span>{notice.message}</span>
            <button
              type="button"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}
              onClick={() => setNotice(null)}
              aria-label="关闭通知"
            >
              ×
            </button>
          </div>
        )}
        {check && check.status !== 'ready' && (
          <div className={`${s.banner} ${s.bannerWarning}`} role="status">
            <div>
              <strong>还需要完善：</strong> 发现 {check.issues.length} 处需要核对的内容
              {check.missingCapabilities.length > 0 && '，部分内容暂时不支持运行，请调整后再试演'}
              {check.issues.length > 0 && (
                <ul style={{ margin: '6px 0 0 16px', padding: 0, fontSize: '13px' }}>
                  {check.issues.slice(0, 5).map((iss, i) => (
                    <li key={i}>{issueLabel(iss.path, iss.code)}</li>
                  ))}
                  {check.issues.length > 5 && <li>…还有 {check.issues.length - 5} 项</li>}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Empty workspace state */}
        {!work && (
          <div className={s.workspace}>
            <div className={s.emptyState} style={{ flex: 1 }}>
              <h3>请在左侧选择一个世界作品</h3>
              <p>或者点击「+ 新建世界」开启一段新的平行人生。</p>
            </div>
          </div>
        )}

        {/* ================= Tab 1: 世界设定 ================= */}
        {work && activeTab === 'settings' && (
          <div className={s.workspace}>
            <div className={s.editorPane}>
              <section className={s.card}>
                <div className={s.sectionHeader}>
                  <h3 className={s.sectionTitle}>1. 作品基本信息</h3>
                  <p className={s.sectionHint}>展示在发现页与开局卡片</p>
                </div>
                <div className={s.formGrid}>
                  <div className={s.formField}>
                    <label className={s.fieldLabel} htmlFor="work-title-input">
                      作品标题
                    </label>
                    <input
                      id="work-title-input"
                      className={s.input}
                      value={worldSettings.title}
                      onChange={(e) => handleWorldSettingsChange('title', e.target.value)}
                      placeholder="例：如果，我的公司上市了"
                      disabled={!session.canEdit || busy}
                    />
                  </div>
                  <div className={s.formField}>
                    <label className={s.fieldLabel} htmlFor="work-hook-input">
                      一句话吸引点 (Hook)
                    </label>
                    <input
                      id="work-hook-input"
                      className={s.input}
                      value={worldSettings.hook}
                      onChange={(e) => handleWorldSettingsChange('hook', e.target.value)}
                      placeholder="例：从负债累累到敲钟上市，周旋在多重利益之间"
                      disabled={!session.canEdit || busy}
                    />
                  </div>
                  <div className={s.formFieldFull}>
                    <label className={s.fieldLabel} htmlFor="work-desc-input">
                      详细背景说明
                    </label>
                    <textarea
                      id="work-desc-input"
                      className={s.textarea}
                      value={worldSettings.description}
                      onChange={(e) => handleWorldSettingsChange('description', e.target.value)}
                      placeholder="作品完整的世界观与故事背景描述…"
                      disabled={!session.canEdit || busy}
                    />
                  </div>
                  <div className={s.formFieldFull}>
                    <label className={s.fieldLabel} htmlFor="work-exp-note-input">
                      体验注意事项
                    </label>
                    <input
                      id="work-exp-note-input"
                      className={s.input}
                      value={worldSettings.experienceNote}
                      onChange={(e) => handleWorldSettingsChange('experienceNote', e.target.value)}
                      placeholder="例：本体验包含职场利益抉择与成人情感纠葛，请理性对待"
                      disabled={!session.canEdit || busy}
                    />
                  </div>
                </div>
              </section>

              <section className={s.card}>
                <div className={s.sectionHeader}>
                  <h3 className={s.sectionTitle}>2. 主角设定 (玩家角色)</h3>
                  <p className={s.sectionHint}>仅作为虚构剧本内角色设定，不写入现实档案</p>
                </div>
                <div className={s.formGrid}>
                  <div className={s.formFieldFull}>
                    <label className={s.fieldLabel} htmlFor="protag-identity-input">
                      主角公开身份
                    </label>
                    <input
                      id="protag-identity-input"
                      className={s.input}
                      value={worldSettings.protagonistIdentity}
                      onChange={(e) =>
                        handleWorldSettingsChange('protagonistIdentity', e.target.value)
                      }
                      placeholder="例：28岁，某初创科技公司CEO，单身"
                      disabled={!session.canEdit || busy}
                    />
                  </div>
                  <div className={s.formFieldFull}>
                    <label className={s.fieldLabel} htmlFor="protag-sit-input">
                      开场现实处境
                    </label>
                    <textarea
                      id="protag-sit-input"
                      className={s.textarea}
                      value={worldSettings.protagonistSituation}
                      onChange={(e) =>
                        handleWorldSettingsChange('protagonistSituation', e.target.value)
                      }
                      placeholder="例：公司刚刚完成敲钟，今晚面临庆功宴与私人赴约的严峻冲突…"
                      disabled={!session.canEdit || busy}
                    />
                  </div>
                </div>
              </section>

              <section className={s.card}>
                <h3 className={s.sectionTitle}>故事舞台与幕后背景</h3>
                <label className={s.fieldLabel} htmlFor="world-public-setting">
                  玩家可以知道的世界背景
                </label>
                <textarea
                  id="world-public-setting"
                  className={s.textarea}
                  value={worldSettings.publicSetting}
                  onChange={(e) => handleWorldSettingsChange('publicSetting', e.target.value)}
                  disabled={!session.canEdit || busy}
                />
                <label className={s.fieldLabel} htmlFor="world-hidden-context">
                  仅供内容创作保留的幕后背景
                </label>
                <textarea
                  id="world-hidden-context"
                  className={s.textarea}
                  value={worldSettings.hiddenContext}
                  onChange={(e) => handleWorldSettingsChange('hiddenContext', e.target.value)}
                  disabled={!session.canEdit || busy}
                />
                <p className={s.fieldHint}>
                  幕后背景不会作为玩家已知信息。角色实际知道哪些事实，需要分别指定。
                </p>
              </section>
              <section className={s.card}>
                <h3 className={s.sectionTitle}>剧本封面</h3>
                <label className={s.fieldLabel} htmlFor="publication-cover">
                  选择创作封面
                </label>
                <select
                  id="publication-cover"
                  className={s.input}
                  disabled={!session.canEdit || busy}
                  value={String(
                    (draftContent.work as Record<string, unknown>)?.coverMediaKey ?? '',
                  )}
                  onChange={(e) => handleArtChange('cover', e.target.value)}
                >
                  <option value="">暂不设置</option>
                  {PUBLICATION_ART.filter((a) => a.uses.includes('cover')).map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label}
                    </option>
                  ))}
                </select>
                {publisherArtUrl(
                  draftContent,
                  String((draftContent.work as Record<string, unknown>)?.coverMediaKey ?? ''),
                  'cover',
                ) ? (
                  <img
                    style={{
                      width: '100%',
                      maxHeight: 220,
                      objectFit: 'cover',
                      borderRadius: 12,
                      marginTop: 12,
                    }}
                    alt="剧本创作封面"
                    src={publisherArtUrl(
                      draftContent,
                      String((draftContent.work as Record<string, unknown>)?.coverMediaKey ?? ''),
                      'cover',
                    )}
                  />
                ) : null}
                <p className={s.fieldHint}>
                  这些图片是虚构世界的AI创作素材，不会使用玩家的私人照片。
                </p>
              </section>
              <details className={s.card}>
                <summary>导入完整结构化草稿</summary>
                <p className={s.fieldHint}>
                  用于补全地点、历史消息、日历与剧情等内容。导入只修改当前编辑稿；保存、检查和试演需另外执行。暂不支持的字段会在检查时显示。
                </p>
                <label className={s.fieldLabel} htmlFor="publication-import">
                  完整内容（JSON）
                </label>
                <textarea
                  id="publication-import"
                  className={s.textarea}
                  value={importText}
                  onChange={(e) => {
                    setImportText(e.target.value);
                    setImportError('');
                  }}
                  disabled={!session.canEdit || busy}
                  spellCheck={false}
                />
                {importError && <p role="alert">{importError}</p>}
                <button
                  type="button"
                  className={s.btn}
                  disabled={!session.canEdit || busy || !importText}
                  onClick={() => {
                    try {
                      const raw = JSON.parse(importText);
                      const parsed = PublisherDraftContentSchema.safeParse(raw);
                      if (!parsed.success) {
                        setImportError(
                          '内容不是可保存的草稿，或超过大小限制。原来的编辑内容已保留。',
                        );
                        return;
                      }
                      if (
                        isDraftDirty(savedState, { title: draftTitle, content: draftContent }) &&
                        !window.confirm('导入将替换当前未保存的编辑稿，确认应用吗？')
                      )
                        return;
                      setDraftContent(deepClone(parsed.data));
                      const value = parseWorldSettings(parsed.data, draftTitle);
                      setDraftTitle(value.title);
                      setSelectedActorKey(null);
                      setImportText('');
                      setImportError('');
                      setNotice({ type: 'warning', message: '内容已应用到编辑稿，请核对后保存。' });
                    } catch {
                      setImportError('内容格式有误。原来的编辑内容已保留，请检查后再试。');
                    }
                  }}
                >
                  应用到编辑稿
                </button>
                <button
                  type="button"
                  className={s.btn}
                  disabled={busy}
                  onClick={() => {
                    setImportText('');
                    setImportError('');
                  }}
                >
                  清空导入文字
                </button>
              </details>
              <section className={s.card}>
                <div className={s.sectionHeader}>
                  <h3 className={s.sectionTitle}>3. 世界时空基准</h3>
                  <p className={s.sectionHint}>客观时间与物理位置起点</p>
                </div>
                <div className={s.formGrid}>
                  <div className={s.formField}>
                    <label className={s.fieldLabel} htmlFor="world-start-at">
                      开场日期和时间（北京时间）
                    </label>
                    <input
                      id="world-start-at"
                      className={s.input}
                      type="datetime-local"
                      value={publicationLocalTime(worldSettings.startAt)}
                      onChange={(e) =>
                        handleWorldSettingsChange('startAt', publicationUtcTime(e.target.value))
                      }
                      placeholder="2024-05-18T18:00:00Z"
                      disabled={!session.canEdit || busy}
                    />
                  </div>
                  <div className={s.formField}>
                    <label className={s.fieldLabel} htmlFor="world-start-place">
                      故事开始时你在哪里
                    </label>
                    <select
                      id="world-start-place"
                      className={s.input}
                      value={worldSettings.startPlaceKey}
                      onChange={(e) => handleWorldSettingsChange('startPlaceKey', e.target.value)}
                      disabled={!session.canEdit || busy}
                    >
                      <option value="">请选择起点地点</option>
                      {worldSettings.startPlaceKey &&
                      !plotChoices(draftContent, 'places').some(
                        (p) => p.key === worldSettings.startPlaceKey,
                      ) ? (
                        <option value={worldSettings.startPlaceKey}>原地点引用待核对</option>
                      ) : null}
                      {plotChoices(draftContent, 'places').map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={s.formFieldFull}>
                    <label className={s.fieldLabel} htmlFor="world-tone-input">
                      叙事基调与氛围
                    </label>
                    <input
                      id="world-tone-input"
                      className={s.input}
                      value={worldSettings.tone}
                      onChange={(e) => handleWorldSettingsChange('tone', e.target.value)}
                      placeholder="例：现代都市，现实主义，带有轻度讽刺与职场压迫感"
                      disabled={!session.canEdit || busy}
                    />
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}

        {work && activeTab === 'settings' && (
          <PublisherSpaceEditor
            content={draftContent}
            disabled={busy || !session.canEdit}
            onChange={setDraftContent}
          />
        )}

        {work && activeTab === 'settings' && (
          <PublisherOpeningEditor
            content={draftContent}
            disabled={busy || !session.canEdit}
            onChange={setDraftContent}
          />
        )}

        {/* ================= Tab 2: 人物 (5 区编辑) ================= */}
        {work && activeTab === 'actors' && (
          <div className={s.workspace}>
            {/* Characters List Column */}
            <aside className={s.actorNav} aria-label="角色列表">
              <div className={s.actorNavHeader}>
                <h3 className={s.actorNavTitle}>人物 · {actorList.length}</h3>
                <button
                  type="button"
                  className={s.addActorBtn}
                  onClick={handleAddActor}
                  disabled={!session.canEdit || busy}
                >
                  + 添加
                </button>
              </div>

              <div className={s.actorList} role="tablist" aria-orientation="vertical">
                {actorList.length === 0 ? (
                  <p className={s.configNotice}>尚无人物，点击上方添加</p>
                ) : (
                  actorList.map((a) => {
                    const isSelected = selectedActorKey === a.key;
                    const identity = (a.publicCard as Record<string, unknown> | undefined)
                      ?.identity;
                    const key = (a.publicCard as Record<string, unknown> | undefined)
                      ?.avatarMediaKey;
                    const art = publisherArtUrl(
                      draftContent,
                      typeof key === 'string' ? key : undefined,
                      'avatar',
                    );
                    return (
                      <button
                        key={a.key}
                        type="button"
                        role="tab"
                        aria-selected={isSelected}
                        className={`${s.actorItem} ${isSelected ? s.activeActor : ''}`}
                        onClick={() => setSelectedActorKey(a.key)}
                      >
                        <div className={`${s.avatarCircle} ${isSelected ? s.activeAvatar : ''}`}>
                          {art ? (
                            <img
                              src={art}
                              alt=""
                              loading="lazy"
                              style={{
                                width: '100%',
                                height: '100%',
                                borderRadius: 'inherit',
                                objectFit: 'cover',
                              }}
                            />
                          ) : (
                            getAvatarChar(a.name)
                          )}
                        </div>
                        <div className={s.actorMeta}>
                          <span className={s.actorName}>{a.name || '未命名'}</span>
                          <span className={s.actorIdentityBrief}>
                            {typeof identity === 'string' && identity.trim()
                              ? identity
                              : '暂无身份说明'}
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>

            {/* Right Form: 5 Sections for Active Character */}
            {currentActorForm ? (
              <div className={s.editorPane}>
                {/* Character Header Bar */}
                <div className={s.actorHeaderCard}>
                  <div className={s.actorHeaderInfo}>
                    <div className={`${s.avatarCircle} ${s.largeAvatar} ${s.activeAvatar}`}>
                      {publisherArtUrl(draftContent, currentActorForm.avatarMediaKey, 'avatar') ? (
                        <img
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            borderRadius: 'inherit',
                          }}
                          alt={`${currentActorForm.name}的创作形象`}
                          src={publisherArtUrl(
                            draftContent,
                            currentActorForm.avatarMediaKey,
                            'avatar',
                          )}
                        />
                      ) : (
                        getAvatarChar(currentActorForm.name)
                      )}
                    </div>
                    <div>
                      <div className={s.actorHeaderTitle}>
                        <strong style={{ fontSize: 18 }}>
                          {currentActorForm.name || '未命名'}
                        </strong>
                        <span className={s.tagFiction}>虚构角色</span>
                      </div>
                      <label className={s.fieldLabel} htmlFor="publication-avatar">
                        人物形象（AI创作）
                      </label>
                      <select
                        id="publication-avatar"
                        className={s.input}
                        disabled={!session.canEdit || busy}
                        value={currentActorForm.avatarMediaKey}
                        onChange={(e) => handleArtChange('avatar', e.target.value)}
                      >
                        <option value="">使用姓名头像</option>
                        {PUBLICATION_ART.filter((a) => a.uses.includes('avatar')).map((a) => (
                          <option key={a.key} value={a.key}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <button
                    type="button"
                    className={s.deleteActorBtn}
                    onClick={handleDeleteActorRequest}
                    disabled={!session.canEdit || busy}
                  >
                    删除人物
                  </button>
                </div>

                {/* Section 1: 名字与身份 */}
                <section className={s.card}>
                  <div className={s.sectionHeader}>
                    <h4 className={s.sectionTitle}>1. 名字与身份</h4>
                    <span className={s.fieldHint}>稳定标识: {currentActorForm.key}</span>
                  </div>
                  <div className={s.formGrid}>
                    <div className={s.formField}>
                      <label className={s.fieldLabel} htmlFor="actor-name-input">
                        名字
                      </label>
                      <input
                        id="actor-name-input"
                        className={s.input}
                        value={currentActorForm.name}
                        onChange={(e) => handleActorChange('name', e.target.value)}
                        placeholder="例：青青"
                        disabled={!session.canEdit || busy}
                      />
                    </div>
                    <div className={s.formField}>
                      <label className={s.fieldLabel} htmlFor="actor-identity-input">
                        身份与年龄
                      </label>
                      <input
                        id="actor-identity-input"
                        className={s.input}
                        value={currentActorForm.identity}
                        onChange={(e) => handleActorChange('identity', e.target.value)}
                        placeholder="例：21岁 · 大三学生"
                        disabled={!session.canEdit || busy}
                      />
                    </div>
                    <div className={s.formFieldFull}>
                      <label className={s.fieldLabel} htmlFor="actor-appear-input">
                        外貌与形象说明 (选填)
                      </label>
                      <input
                        id="actor-appear-input"
                        className={s.input}
                        value={currentActorForm.appearance}
                        onChange={(e) => handleActorChange('appearance', e.target.value)}
                        placeholder="例：黑色中长发，常穿浅色外套，笑起来带一点狡黠"
                        disabled={!session.canEdit || busy}
                      />
                    </div>
                  </div>
                </section>

                {/* Section 2: 与主角的初始关系 */}
                <section className={s.card}>
                  <div className={s.sectionHeader}>
                    <h4 className={s.sectionTitle}>2. 与主角的初始关系</h4>
                    <span className={s.fieldHint}>开场双方的既有认知关系</span>
                  </div>
                  <label>
                    <input
                      type="checkbox"
                      checked={currentActorForm.knownAtStart}
                      disabled={!session.canEdit || busy}
                      onChange={(event) => handleActorChange('knownAtStart', event.target.checked)}
                    />
                    开场时玩家已经认识这个人物
                  </label>
                  <div className={s.formFieldFull}>
                    <label className={s.fieldLabel} htmlFor="actor-rel-input">
                      初始人际关系描述
                    </label>
                    <textarea
                      id="actor-rel-input"
                      className={s.textarea}
                      style={{ minHeight: 80 }}
                      value={currentActorForm.relationshipToPlayer}
                      onChange={(e) => handleActorChange('relationshipToPlayer', e.target.value)}
                      placeholder="例：从小一起长大的邻家朋友，无血缘关系。习惯叫你哥。"
                      disabled={!session.canEdit || busy}
                    />
                  </div>
                </section>

                {/* Section 3: 性格与说话方式 */}
                <section className={s.card}>
                  <div className={s.sectionHeader}>
                    <h4 className={s.sectionTitle}>3. 性格与说话方式</h4>
                    <span className={s.fieldHint}>直接约束 AI 角色回复口吻</span>
                  </div>
                  <div className={s.formFieldFull}>
                    <label className={s.fieldLabel} htmlFor="actor-voice-input">
                      性格特征与语言风格
                    </label>
                    <textarea
                      id="actor-voice-input"
                      className={s.textarea}
                      style={{ minHeight: 110 }}
                      value={currentActorForm.voice}
                      onChange={(e) => handleActorChange('voice', e.target.value)}
                      placeholder={`嘴硬心软，爱开玩笑，失落时会装作不在乎。\n说话短，习惯叫你哥，不会直说自己吃醋。`}
                      disabled={!session.canEdit || busy}
                    />
                  </div>

                  {/* Collapsible deep background */}
                  <details className={s.disclosure}>
                    <summary className={s.disclosureSummary}>
                      展开完整经历与背景故事（可选）
                    </summary>
                    <div className={s.disclosureContent}>
                      <label className={s.fieldLabel} htmlFor="actor-bg-input">
                        成长背景与深层心理
                      </label>
                      <textarea
                        id="actor-bg-input"
                        className={s.textarea}
                        value={currentActorForm.background}
                        onChange={(e) => handleActorChange('background', e.target.value)}
                        placeholder="记录该人物的家庭出身、求学及工作经历，供长上下文参考…"
                        disabled={!session.canEdit || busy}
                      />
                    </div>
                  </details>
                </section>

                {/* Section 4: 在乎什么、眼前想法 */}
                <section className={s.card}>
                  <div className={s.sectionHeader}>
                    <h4 className={s.sectionTitle}>4. 在乎什么、眼前想法</h4>
                    <span className={s.fieldHint}>驱动剧情与主动微信的内在动机</span>
                  </div>
                  <div className={s.formGrid}>
                    <div className={s.formFieldFull}>
                      <label className={s.fieldLabel} htmlFor="actor-cares-input">
                        在乎什么 (长期核心价值观)
                      </label>
                      <input
                        id="actor-cares-input"
                        className={s.input}
                        value={currentActorForm.caresAbout}
                        onChange={(e) => handleActorChange('caresAbout', e.target.value)}
                        placeholder="例：被认真对待，不因你的身份变化而变得疏远。"
                        disabled={!session.canEdit || busy}
                      />
                    </div>
                    <div className={s.formFieldFull}>
                      <label className={s.fieldLabel} htmlFor="actor-goal-input">
                        眼前目标 (开场最先想达成的想法)
                      </label>
                      <input
                        id="actor-goal-input"
                        className={s.input}
                        value={currentActorForm.immediateGoal}
                        onChange={(e) => handleActorChange('immediateGoal', e.target.value)}
                        placeholder="例：今晚和你单独吃一碗以前常吃的面。"
                        disabled={!session.canEdit || busy}
                      />
                    </div>
                  </div>
                </section>

                {/* Section 5: 关系、知情范围与底线 */}
                <section className={s.card}>
                  <div className={s.sectionHeader}>
                    <h4 className={s.sectionTitle}>5. 关系、知情范围与底线</h4>
                    <span className={s.fieldHint}>明确已知信息差与行为底线</span>
                  </div>
                  <fieldset disabled={!session.canEdit || busy}>
                    <legend>这个人物开场已经知道的事实</legend>
                    <p className={s.fieldHint}>
                      这些是剧本中的既有事实，可以修改，不是固定示例。勾选只决定这个人物是否知情。
                    </p>
                    {plotData.history.length === 0 ? (
                      <p className={s.fieldHint}>
                        还没有可选择的既有事实。请到剧情页新增或核对原稿，不会自动授予人物知情。
                      </p>
                    ) : (
                      plotData.history.map((f, index) => {
                        const raw = plotRows(draftContent, 'history').find(
                          (row) => plotRecord(row).key === f.key,
                        );
                        const editable =
                          plotRowEditable(draftContent, 'history', f.key) &&
                          typeof plotRecord(raw).text === 'string';
                        const inputId = `actor-fact-${index}-${f.key}`;
                        return (
                          <div key={`${index}-${f.key}`} style={{ margin: '12px 0' }}>
                            <label style={{ display: 'block', margin: '8px 0' }}>
                              <input
                                type="checkbox"
                                disabled={!editable}
                                checked={currentActorForm.knownFactKeys.includes(f.key)}
                                onChange={(e) =>
                                  handleActorChange(
                                    'knownFactKeys',
                                    e.target.checked
                                      ? [...currentActorForm.knownFactKeys, f.key]
                                      : currentActorForm.knownFactKeys.filter((k) => k !== f.key),
                                  )
                                }
                              />
                              {f.text}
                            </label>
                            {editable ? (
                              <details>
                                <summary>修改这条事实</summary>
                                <label className={s.fieldLabel} htmlFor={inputId}>
                                  事实文字（剧本共用）
                                </label>
                                <textarea
                                  id={inputId}
                                  className={s.textarea}
                                  rows={3}
                                  maxLength={1000}
                                  value={f.text}
                                  disabled={!session.canEdit || busy}
                                  onChange={(e) => {
                                    if (!session.canEdit || busy) return;
                                    const text = e.target.value;
                                    setDraftContent((current) => {
                                      const fact = plotRows(current, 'history').find(
                                        (row) => plotRecord(row).key === f.key,
                                      );
                                      if (
                                        !plotRowEditable(current, 'history', f.key) ||
                                        typeof plotRecord(fact).text !== 'string'
                                      )
                                        return current;
                                      return patchPlotField(
                                        current,
                                        'history',
                                        f.key,
                                        ['text'],
                                        text,
                                      );
                                    });
                                  }}
                                />
                                <p className={s.fieldHint}>
                                  修改后请保存草稿。这条事实在各人物的知情列表中同步更新，勾选保持不变；不改动已发布的玩家存档。
                                </p>
                              </details>
                            ) : (
                              <p className={s.fieldHint}>
                                这条事实的格式或标识待核对，原内容已保留。
                              </p>
                            )}
                          </div>
                        );
                      })
                    )}
                  </fieldset>
                  <button
                    type="button"
                    className={`${s.btn} ${s.btnSecondary}`}
                    disabled={busy}
                    onClick={() => setActiveTab('plot')}
                  >
                    到剧情页管理或新增事实
                  </button>
                  <div className={s.formFieldFull}>
                    <label className={s.fieldLabel} htmlFor="actor-bounds-input">
                      知情范围与底线规则
                    </label>
                    <textarea
                      id="actor-bounds-input"
                      className={s.textarea}
                      style={{ minHeight: 120 }}
                      value={currentActorForm.boundaries}
                      onChange={(e) => handleActorChange('boundaries', e.target.value)}
                      placeholder={`知道：今天是你公司上市的大日子。\n不知道：庆功宴也在今晚，她还没收到改期消息。\n底线：不接受用钱替代陪伴，拒绝后不会自动答应。`}
                      disabled={!session.canEdit || busy}
                    />
                    <p className={s.fieldHint} style={{ marginTop: 4 }}>
                      提示：写清楚她知道什么、不知道什么，以及遇到拒绝后的坚守底线。
                    </p>
                  </div>
                </section>
              </div>
            ) : (
              <div className={s.editorPane}>
                <div className={s.emptyState}>
                  <h4>请在左侧选择或添加一个人物进行编辑</h4>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Plot authoring uses the same unsaved draft and real save/check pipeline. */}
        {work && activeTab === 'plot' && (
          <div className={s.workspace}>
            <PublisherPlotEditor
              content={draftContent}
              disabled={busy || !session.canEdit}
              onChange={setDraftContent}
            />
          </div>
        )}
      </main>

      {/* ================= Deletion Warning Dialog ================= */}
      {deletionWarning && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 20,
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="del-warn-title"
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: 24,
              maxWidth: 480,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
            }}
          >
            <h3 id="del-warn-title" style={{ margin: 0, color: '#a32632' }}>
              存在关联引用，无法直接删除
            </h3>
            <p style={{ margin: 0, fontSize: 14, color: '#475569' }}>
              人物「{deletionWarning.actorName}」在当前剧情中已被以下{' '}
              {deletionWarning.references.length} 处设定直接引用。直接删除会导致剧情断层：
            </p>
            <ul
              style={{
                margin: 0,
                paddingLeft: 20,
                fontSize: 13,
                color: '#334155',
                maxHeight: 180,
                overflowY: 'auto',
              }}
            >
              {deletionWarning.references.map((ref, idx) => (
                <li key={idx}>{ref.label}</li>
              ))}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button
                type="button"
                className={`${s.btn} ${s.btnSecondary}`}
                onClick={() => setDeletionWarning(null)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= Create Work Modal ================= */}
      {showMarkdownImport && work && (
        <PublisherImportDialog
          workId={work.id}
          version={work.draft.version}
          content={draftContent}
          disabled={busy || !session.canEdit}
          onClose={() => setShowMarkdownImport(false)}
          onApply={(next, summary) => {
            setDraftContent(next);
            setMarkdownReview(summary);
            const nextWork = next.work as { title?: unknown } | undefined;
            if (typeof nextWork?.title === 'string') setDraftTitle(nextWork.title);
            setNotice({
              type: 'warning',
              message: '已填入当前编辑稿，尚未保存。请补齐提示的缺项，再保存、检查和试演。',
            });
          }}
        />
      )}

      {showCreateModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 20,
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-work-title"
        >
          <form
            onSubmit={handleCreateWorkSubmit}
            style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: 24,
              maxWidth: 440,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
            }}
          >
            <h3 id="create-work-title" style={{ margin: 0, fontSize: 18 }}>
              新建世界作品
            </h3>
            <div className={s.formField}>
              <label className={s.fieldLabel} htmlFor="new-work-title">
                作品名称
              </label>
              <input
                id="new-work-title"
                className={s.input}
                value={newWorkTitle}
                onChange={(e) => setNewWorkTitle(e.target.value)}
                placeholder="例：如果，我成为了旅行摄影师"
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className={`${s.btn} ${s.btnSecondary}`}
                onClick={() => setShowCreateModal(false)}
              >
                取消
              </button>
              <button
                type="submit"
                className={`${s.btn} ${s.btnPrimary}`}
                disabled={busy || !session.canEdit || !newWorkTitle.trim()}
              >
                确认创建
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
