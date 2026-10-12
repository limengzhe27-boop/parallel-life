'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { PublisherWorkbenchProps } from '../../contracts/publisher-workbench.ts';
import {
  parseActorEditor,
  updateActorInContent,
  createEmptyActor,
  checkActorDeletionSafety,
  deleteActorFromContent,
  parseWorldSettings,
  updateWorldSettingsInContent,
  parsePlotData,
  isDraftDirty,
  deepClone,
  type ActorEditorForm,
  type WorldSettingsForm,
} from './publisher-editor.ts';
import s from './publisher-workbench.module.css';

type MainTab = 'settings' | 'actors' | 'plot';

export function PublisherWorkbench(props: PublisherWorkbenchProps) {
  const session = props.session ?? { displayName: '编剧', canEdit: true, canPublish: true };
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
  const [loadedDraftVersion, setLoadedDraftVersion] = useState<number | null>(() => work?.draft?.version ?? null);

  // Status message notice
  const [notice, setNotice] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);

  // Deletion confirmation warning dialog state
  const [deletionWarning, setDeletionWarning] = useState<{
    actorKey: string;
    actorName: string;
    references: Array<{ category: string; key: string; label: string }>;
  } | null>(null);

  // Modal for creating new work
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWorkTitle, setNewWorkTitle] = useState('');

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
      setDraftTitle(work.title);
      setDraftContent(deepClone(work.draft.content));
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
    return isDraftDirty(savedState, { title: draftTitle, content: draftContent });
  }, [savedState, draftTitle, draftContent]);

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

  // Plot data
  const plotData = useMemo(() => {
    return parsePlotData(draftContent);
  }, [draftContent]);

  // Handle actor field edits
  const handleActorChange = useCallback(
    (field: keyof ActorEditorForm, value: unknown) => {
      if (!currentActorForm) return;
      const updatedForm: ActorEditorForm = {
        ...currentActorForm,
        [field]: value,
      };
      const nextContent = updateActorInContent(draftContent, updatedForm);
      setDraftContent(nextContent);
    },
    [currentActorForm, draftContent],
  );

  // Handle world settings edits
  const handleWorldSettingsChange = useCallback(
    (field: keyof WorldSettingsForm, value: string) => {
      const nextSettings: WorldSettingsForm = {
        ...worldSettings,
        [field]: value,
      };
      if (field === 'title') {
        setDraftTitle(value);
      }
      const nextContent = updateWorldSettingsInContent(draftContent, nextSettings);
      setDraftContent(nextContent);
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

  // Confirm delete despite warnings or after user acknowledgment
  const handleForceDeleteActor = useCallback(() => {
    if (!deletionWarning) return;
    const nextContent = deleteActorFromContent(draftContent, deletionWarning.actorKey);
    setDraftContent(nextContent);
    const remaining = actorList.filter((a) => a.key !== deletionWarning.actorKey);
    setSelectedActorKey(remaining[0]?.key ?? null);
    setDeletionWarning(null);
    setNotice({ type: 'warning', message: `已强制删除人物「${deletionWarning.actorName}」，请核对相关剧情。` });
  }, [deletionWarning, draftContent, actorList]);

  // Save draft
  const handleSaveDraft = useCallback(() => {
    if (!work) return;
    if (!session.canEdit) {
      setNotice({ type: 'error', message: '权限不足：当前账号未被授予编辑作品权限。' });
      return;
    }
    setNotice(null);
    onSaveDraft({
      title: draftTitle,
      content: draftContent,
    });
  }, [work, session.canEdit, draftTitle, draftContent, onSaveDraft]);

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
            title: newWorkTitle.trim(),
            hook: '',
            description: '',
            experienceNote: '',
          },
          world: {
            publicSetting: '',
            tone: '',
            startAt: '2024-05-18T10:00:00Z',
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
        const confirmed = window.confirm('当前作品有未保存的编辑内容，切换后未保存草稿将被放弃，是否继续？');
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
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
          <button type="button" className={s.btnLogout} onClick={onLogout}>
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
                  disabled={busy}
                  title="运行发布前完整一致性检查"
                >
                  检查
                </button>

                <button
                  type="button"
                  className={`${s.btn} ${s.btnTrial}`}
                  onClick={onTrial ? () => onTrial() : undefined}
                  disabled={busy || !onTrial}
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
                    check?.status !== 'ready'
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
              <strong>检查未通过 ({check.status})：</strong> 发现 {check.issues.length} 处规范问题
              {check.missingCapabilities.length > 0 && `，缺少能力: ${check.missingCapabilities.join(', ')}`}
              {check.issues.length > 0 && (
                <ul style={{ margin: '6px 0 0 16px', padding: 0, fontSize: '13px' }}>
                  {check.issues.slice(0, 5).map((iss, i) => (
                    <li key={i}>
                      {iss.path.join('.')}: {iss.code}
                    </li>
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
                      disabled={!session.canEdit}
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
                      disabled={!session.canEdit}
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
                      disabled={!session.canEdit}
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
                      disabled={!session.canEdit}
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
                      onChange={(e) => handleWorldSettingsChange('protagonistIdentity', e.target.value)}
                      placeholder="例：28岁，某初创科技公司CEO，单身"
                      disabled={!session.canEdit}
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
                      onChange={(e) => handleWorldSettingsChange('protagonistSituation', e.target.value)}
                      placeholder="例：公司刚刚完成敲钟，今晚面临庆功宴与私人赴约的严峻冲突…"
                      disabled={!session.canEdit}
                    />
                  </div>
                </div>
              </section>

              <section className={s.card}>
                <div className={s.sectionHeader}>
                  <h3 className={s.sectionTitle}>3. 世界时空基准</h3>
                  <p className={s.sectionHint}>客观时间与物理位置起点</p>
                </div>
                <div className={s.formGrid}>
                  <div className={s.formField}>
                    <label className={s.fieldLabel} htmlFor="world-start-at">
                      开场世界时间 (ISO 8601)
                    </label>
                    <input
                      id="world-start-at"
                      className={s.input}
                      value={worldSettings.startAt}
                      onChange={(e) => handleWorldSettingsChange('startAt', e.target.value)}
                      placeholder="2024-05-18T18:00:00Z"
                      disabled={!session.canEdit}
                    />
                  </div>
                  <div className={s.formField}>
                    <label className={s.fieldLabel} htmlFor="world-start-place">
                      起点地点标识 (Place Key)
                    </label>
                    <input
                      id="world-start-place"
                      className={s.input}
                      value={worldSettings.startPlaceKey}
                      onChange={(e) => handleWorldSettingsChange('startPlaceKey', e.target.value)}
                      placeholder="place_office"
                      disabled={!session.canEdit}
                    />
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
                      disabled={!session.canEdit}
                    />
                  </div>
                </div>
              </section>
            </div>
          </div>
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
                    const identity = (a.publicCard as Record<string, unknown> | undefined)?.identity;
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
                          {getAvatarChar(a.name)}
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
                      {getAvatarChar(currentActorForm.name)}
                    </div>
                    <div>
                      <div className={s.actorHeaderTitle}>
                        <strong style={{ fontSize: 18 }}>{currentActorForm.name || '未命名'}</strong>
                        <span className={s.tagFiction}>虚构角色</span>
                      </div>
                      <button
                        type="button"
                        className={s.avatarLink}
                        onClick={() => alert('素材库上传将在独立素材管理器中开放，当前使用文字首字母头像。')}
                      >
                        更换头像
                      </button>
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
                        disabled={!session.canEdit}
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
                        disabled={!session.canEdit}
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
                        disabled={!session.canEdit}
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
                      disabled={!session.canEdit}
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
                      disabled={!session.canEdit}
                    />
                  </div>

                  {/* Collapsible deep background */}
                  <details className={s.disclosure}>
                    <summary className={s.disclosureSummary}>展开完整经历与背景故事（可选）</summary>
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
                        disabled={!session.canEdit}
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
                        disabled={!session.canEdit}
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
                        disabled={!session.canEdit}
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
                      disabled={!session.canEdit}
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

        {/* ================= Tab 3: 剧情 ================= */}
        {work && activeTab === 'plot' && (
          <div className={s.workspace}>
            <div className={s.editorPane}>
              {/* History Facts */}
              <section className={s.card}>
                <div className={s.sectionHeader}>
                  <h3 className={s.sectionTitle}>已发生客观历史事实 ({plotData.history.length})</h3>
                  <p className={s.sectionHint}>开场前已确立的事实，可被人物知情引用</p>
                </div>
                {plotData.history.length === 0 ? (
                  <p className={s.configNotice}>尚未录入既定历史事实</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {plotData.history.map((h) => (
                      <div
                        key={h.key}
                        style={{
                          padding: '10px 14px',
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          borderRadius: 8,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                          <strong>{h.key}</strong>
                          <span style={{ color: '#64748b' }}>{h.occurredAt}</span>
                        </div>
                        <p style={{ margin: '6px 0 0', fontSize: 14 }}>{h.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Candidates */}
              <section className={s.card}>
                <div className={s.sectionHeader}>
                  <h3 className={s.sectionTitle}>剧情候选节点 ({plotData.candidates.length})</h3>
                  <p className={s.sectionHint}>待满足条件触发的可选事件（非必经任务）</p>
                </div>
                {plotData.candidates.length === 0 ? (
                  <p className={s.configNotice}>尚未配置候选剧情事件</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {plotData.candidates.map((c) => (
                      <div
                        key={c.key}
                        style={{
                          padding: '12px 16px',
                          background: '#ffffff',
                          border: '1px solid #d8dee9',
                          borderRadius: 8,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <strong style={{ fontSize: 15 }}>{c.title}</strong>
                          <span style={{ fontSize: 12, color: '#566276' }}>{c.key}</span>
                        </div>
                        <p style={{ margin: '6px 0 0', fontSize: 14, color: '#334155' }}>
                          {c.editorialIntent}
                        </p>
                        {c.actorKeys.length > 0 && (
                          <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
                            参与角色：{c.actorKeys.join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
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
              人物「{deletionWarning.actorName}」在当前剧情中已被以下 {deletionWarning.references.length}{' '}
              处设定直接引用。直接删除会导致剧情断层：
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
              <button
                type="button"
                className={`${s.btn}`}
                style={{ background: '#a32632', color: '#fff' }}
                onClick={handleForceDeleteActor}
              >
                强行解除引用并删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= Create Work Modal ================= */}
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
                disabled={!newWorkTitle.trim()}
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
