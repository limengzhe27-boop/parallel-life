'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { PUBLICATION_ART } from '../../contracts/publication-assets.ts';
import { publisherArtUrl, selectPublisherArt, importCustomPublisherArt } from './publisher-art-model.ts';
import { publicationLocalTime, publicationUtcTime } from './publisher-story-time.ts';
import { readOverallSetting, updateOverallSetting } from './publisher-overall-setting.ts';
import { PublisherPlotEditor } from './publisher-plot-editor.tsx';
import { phoneTrialMatches, type PublisherPhoneTrial } from './publisher-phone-trial.ts';
import {
  characterManuscriptSource,
  currentCharacterManuscripts,
} from './publisher-character-manuscript.ts';
import { PublisherCharacterPreview } from './publisher-character-preview.tsx';
import { PublisherCharacterSocialEditor } from './publisher-character-social-editor.tsx';
import {
  CHARACTER_MODULES,
  characterModuleText,
  characterIntroductionText,
  characterLegacyModuleText,
  characterFieldEditable,
  updateCharacterField,
  type CharacterModuleKey,
} from './publisher-character-model.ts';
import {
  PublisherImportDialog,
  manuscriptFingerprint,
  preparationMatches,
} from './publisher-import-dialog.tsx';
import { PublisherPreparationInputSchema } from '../../contracts/publisher-preparation.ts';
import { applyDirectSocialProposal } from './publisher-social-direct.ts';
import { PublisherScheduleReview } from './publisher-schedule-review.tsx';
import { planPublicationTimes } from '../../modules/settings/domain/publication-scheduling.ts';
import type { PublisherSchedule } from '../../contracts/publisher-preparation.ts';
import { PublisherSpaceEditor } from './publisher-space-editor.tsx';
import { PublisherOpeningEditor } from './publisher-opening-editor.tsx';
import { PublisherClientError, type PublisherClient } from './publisher-client.ts';
import type { ImportSummary } from './publisher-importer.ts';
import {
  patchPlotField,
  plotChoices,
  plotRecord,
  plotRows,
  plotRowEditable,
} from './publisher-plot-model.ts';
import type {
  PublisherWorkbenchProps,
  PublisherWorkbenchDraft,
} from '../../contracts/publisher-workbench.ts';
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

type MainTab = 'settings' | 'actors' | 'plot' | 'review';

function issueLabel(path: readonly (string | number)[], code: string) {
  if (code === 'trial_unverified') return '请先试演，并完成一条真实的角色对话，再重新检查。';
  if (code === 'media_unverified') return '素材尚未核验，请检查所选图片后再试。';
  const hints: Record<string, string> = {
    unsupported_director_completion_dependency:
      '这里需要前一事件真正完成。目前支持事件入场，尚不能判定整件事完成；请保留原稿，等待分步演绎支持。',
    unsupported_director_completion_stage:
      '这一阶段需要前面事件真正完成。目前不能可靠推进这种阶段衔接，请保留原稿，等待分步演绎支持。',
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
            ? '有暂不支持的内容，请核对后调整'
            : '请核对内容与引用是否完整一致');
  return `${group}${row}${group ? ' · ' : ''}${field}：${reason}`;
}

export function PublisherWorkbench(
  props: PublisherWorkbenchProps & {
    preparationClient?: PublisherClient;
    characterTrial?: PublisherPhoneTrial | null;
    draftSaving?: boolean;
    characterTrialMessage?: string | null;
    characterTrialError?: string;
    onCharacterTrial?: (draft?: PublisherWorkbenchDraft) => void;
    onCloseCharacterTrial?: () => void;
  },
) {
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
    onRenameWork,
    onDeleteWork,
    onCheck,
    onTrial,
    onPublish,
    onLogout,
  } = props;

  // Active main tab
  const [activeTab, setActiveTab] = useState<MainTab>('settings');
  const [settingsOpen, setSettingsOpen] = useState(false);

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
  const [showMarkdownImport, setShowMarkdownImport] = useState(false);
  const [markdownReview, setMarkdownReview] = useState<ImportSummary>();
  const [scheduleReview, setScheduleReview] = useState<{
    key: string;
    schedule: PublisherSchedule;
  }>();

  const [overallInput, setOverallInput] = useState<string | undefined>();
  const [overallPreparationText, setOverallPreparationText] = useState<string | undefined>();
  const [formPreparationSources, setFormPreparationSources] = useState<
    { filename: string; content: string }[] | undefined
  >();
  const [formPreparationScope, setFormPreparationScope] = useState<
    'world' | 'characters' | undefined
  >();
  const [formSocialFocus, setFormSocialFocus] = useState<
    'history' | 'moments' | 'both' | undefined
  >();
  const [formSocialActorKey, setFormSocialActorKey] = useState<string | undefined>();
  const [socialGenerating, setSocialGenerating] = useState<'history' | 'moments' | null>(null);
  const [socialGenerationMessage, setSocialGenerationMessage] = useState<string | null>(null);
  const [socialGenerationError, setSocialGenerationError] = useState<string | null>(null);
  const [socialInFlight] = useState(() => ({ current: false }));
  const [liveSocialDraft] = useState(() => ({
    current: { workId: work?.id, content: draftContent },
  }));
  liveSocialDraft.current = { workId: work?.id, content: draftContent };
  const overall = useMemo(() => readOverallSetting(draftContent), [draftContent]);
  const overallText = overallInput ?? overall.text;
  const overallUpdate = useMemo(
    () => updateOverallSetting(draftContent, overallText),
    [draftContent, overallText],
  );
  const overallBlocked = overallInput !== undefined && !overallUpdate.ok;
  const overallProblem = overallUpdate.ok ? undefined : overallUpdate.reason;
  const overallMessage =
    overallProblem === 'extension_budget'
      ? '这段总体设定太长，暂不能保存或整理。文字已完整留在这里，请精简后再试。'
      : overallProblem === 'extensions_budget' ||
          overallProblem === 'content_budget' ||
          overallProblem === 'extension_limit'
        ? '这份作品的资料已接近容量上限，暂不能加入这段总体设定。文字已保留，请精简后再试。'
        : overallProblem
          ? '已有创作资料还需核对，暂不能替换总体设定。原资料和当前输入均已保留。'
          : undefined;
  function changeOverall(text: string) {
    if (busy || !session.canEdit) return;
    setScheduleReview(undefined);
    setOverallInput(text);
    const result = updateOverallSetting(draftContent, text);
    if (result.ok) setDraftContent(result.content);
  }
  function onPrepareOverall(text: string) {
    if (
      !work ||
      busy ||
      !session.canEdit ||
      !props.preparationClient ||
      !text.trim() ||
      !updateOverallSetting(draftContent, text).ok
    )
      return;
    setOverallPreparationText(text);
    setFormPreparationSources(currentCharacterManuscripts(draftContent));
    setFormPreparationScope('world');
    setFormSocialFocus(undefined);
    setFormSocialActorKey(undefined);
    setShowMarkdownImport(true);
  }
  async function onGenerateCharacterSocial(actorKey: string, focus: 'history' | 'moments') {
    if (!work || busy || !session.canEdit || !props.preparationClient || socialInFlight.current)
      return;
    const source = characterManuscriptSource(draftContent, actorKey);
    if (!source) {
      setSocialGenerationError('请先填写这位人物的姓名与设定，再让 AI 帮忙补充。');
      return;
    }
    const client = props.preparationClient;
    const workId = work.id;
    const version = work.draft.version;
    const baseline = draftContent;
    const sources = [source];
    const input = PublisherPreparationInputSchema.safeParse({
      commandId: crypto.randomUUID(),
      expectedDraftVersion: version,
      scope: 'characters',
      socialFocus: focus,
      socialActorKey: actorKey,
      currentContent: baseline,
      sources,
    });
    if (!input.success) {
      setSocialGenerationError('当前人物资料还不完整或太长，请保存并核对后再试。');
      return;
    }
    socialInFlight.current = true;
    setSocialGenerating(focus);
    setSocialGenerationMessage(`正在为这位人物补${focus === 'moments' ? '朋友圈' : '历史聊天'}…`);
    setSocialGenerationError(null);
    try {
      // Recover an identical persisted operation before admitting another paid request.
      const latest = (await client.latestPreparation(workId)).preparation;
      let record =
        latest &&
        latest.status !== 'failed' &&
        preparationMatches(
          latest,
          workId,
          version,
          baseline,
          sources,
          undefined,
          'characters',
          focus,
          actorKey,
        )
          ? latest
          : await client.prepareManuscript(workId, input.data);
      for (let attempt = 0; record.status === 'running' && attempt < 40; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        record = await client.getPreparation(workId, record.commandId);
      }
      if (record.status === 'running' || record.status === 'unknown') {
        setSocialGenerationError(
          '这次生成结果尚未确认。再次点击会先查询原操作，不会重复发起生成。',
        );
        return;
      }
      if (record.status !== 'succeeded' || !record.result) {
        setSocialGenerationError('这次没能生成可用内容，请稍后重试。');
        return;
      }
      if (record.result.issues.length) {
        setSocialGenerationError('生成的内容有待核对的问题，本次没有填入草稿。请稍后重试。');
        return;
      }
      if (
        liveSocialDraft.current.workId !== workId ||
        manuscriptFingerprint(liveSocialDraft.current.content) !== manuscriptFingerprint(baseline)
      ) {
        setSocialGenerationError('生成期间草稿有了新修改，本次没有覆盖你的内容。请保存后重试。');
        return;
      }
      const adopted = applyDirectSocialProposal(
        baseline,
        record.result.updatedContent,
        actorKey,
        focus,
      );
      if (adopted.error) {
        if (adopted.error === 'NO_NEW_CONTENT')
          setSocialGenerationMessage('这次没有新的内容可补，已有内容保持原样。');
        else setSocialGenerationError('生成结果与当前人物内容不一致，本次没有改动草稿。');
        return;
      }
      setDraftContent(adopted.content);
      setSocialGenerationMessage(
        `已补入 ${adopted.added} 条${focus === 'moments' ? '朋友圈' : '历史聊天'}，正在保存草稿。`,
      );
    } catch (error) {
      setSocialGenerationError(
        error instanceof PublisherClientError && error.code === 'VERSION_CONFLICT'
          ? '草稿已有新版本，请刷新核对后再试。'
          : '暂时没有收到完整结果；再次点击会先查询原操作。',
      );
    } finally {
      socialInFlight.current = false;
      setSocialGenerating(null);
    }
  }

  // Modals for renaming and deleting works
  const [renamingWork, setRenamingWork] = useState<{ id: string; title: string } | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [deletingWork, setDeletingWork] = useState<{ id: string; title: string } | null>(null);

  const handleOpenRename = (target: { id: string; title: string }) => {
    setRenamingWork(target);
    setRenameTitle(target.title);
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingWork || !renameTitle.trim() || !session.canEdit) return;
    const trimmed = renameTitle.trim();
    if (trimmed !== renamingWork.title) {
      onRenameWork?.(renamingWork.id, trimmed);
    }
    setRenamingWork(null);
  };

  const handleOpenDelete = (target: { id: string; title: string }) => {
    setDeletingWork(target);
  };

  const handleDeleteConfirm = () => {
    if (!deletingWork || !session.canEdit) return;
    onDeleteWork?.(deletingWork.id);
    setDeletingWork(null);
  };

  // Sync state when props.work updates or changes workId/draftVersion
  useEffect(() => {
    if (!work) {
      setOverallInput(undefined);
      setOverallPreparationText(undefined);
      setFormPreparationSources(undefined);
      setFormPreparationScope(undefined);
      setFormSocialFocus(undefined);
      setFormSocialActorKey(undefined);
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
      setOverallInput(undefined);
      setOverallPreparationText(undefined);
      setFormPreparationSources(undefined);
      setFormPreparationScope(undefined);
      setFormSocialFocus(undefined);
      setFormSocialActorKey(undefined);
      setShowMarkdownImport(false);
      if (isNewWork) setMarkdownReview(undefined);
      setDraftTitle(work.title);
      setDraftContent(deepClone(work.draft.content));
      setLoadedWorkId(work.id);
      setLoadedDraftVersion(work.draft.version);

      // Auto-select first actor if available
      const actors = Array.isArray(work.draft.content.actors)
        ? (work.draft.content.actors as Array<{ key?: string }>)
        : [];
      if (isNewWork) {
        setActiveTab('settings');
        setSettingsOpen(false);
      }
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
    return overallBlocked || isDraftDirty(savedState, { title: draftTitle, content: draftContent });
  }, [savedState, draftTitle, draftContent, overallBlocked]);
  const [trialRequested] = useState(() => ({ current: false }));
  useEffect(() => {
    if (!busy) trialRequested.current = false;
  }, [busy]);


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

  const handleCharacterFieldChange = useCallback(
    (field: CharacterModuleKey | 'introduction', value: string) => {
      if (!currentActorForm || !session.canEdit || busy) return;
      const actorKey = currentActorForm.key;
      setDraftContent((previous) => updateCharacterField(previous, actorKey, field, value));
    },
    [currentActorForm, session.canEdit, busy],
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
  const handleCustomAvatarImport = (dataUrl: string) => {
    if (!session.canEdit || busy || !currentActorForm) return;
    try {
      const next = importCustomPublisherArt(
        draftContent,
        'avatar',
        dataUrl,
        currentActorForm.key,
        `${currentActorForm.name}的头像`,
      );
      setDraftContent(next);
      setNotice({ type: 'success', message: '已成功导入自定义头像。' });
    } catch {
      setNotice({
        type: 'error',
        message: '头像导入失败，请检查图片格式后再试。',
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
    if (!work || busy || overallBlocked) return;
    if (!session.canEdit) {
      setNotice({ type: 'error', message: '权限不足：当前账号未被授予编辑作品权限。' });
      return;
    }
    setNotice(null);
    onSaveDraft({
      title: draftTitle,
      content: draftContent,
    });
  }, [work, session.canEdit, draftTitle, draftContent, onSaveDraft, overallBlocked, busy]);

  // Handle character trial: atomically pass latest draft
  const handleCharacterTrial = useCallback(() => {
    if ((busy && !props.draftSaving) || overallBlocked) return;
    trialRequested.current = true;
    props.onCharacterTrial?.({
      title: draftTitle,
      content: draftContent,
    });
  }, [busy, props.draftSaving, overallBlocked, props.onCharacterTrial, draftTitle, draftContent]);



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
            startPlaceKey: '',
            hiddenContext: '',
          },
          protagonist: {
            identity: '',
            situation: '',
            knownFactKeys: [],
          },
          actors: [],
          relationships: [],
          places: [],
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

  const currentCheck = !!(
    work &&
    check &&
    !isDirty &&
    check.workId === work.id &&
    check.draftVersion === work.draftVersion &&
    check.contentHash === work.draft.contentHash
  );
  const pendingChecks = check
    ? [
        ...check.issues.map((issue) => issueLabel(issue.path, issue.code)),
        ...check.missingCapabilities.map((capability) =>
          capability === 'model_budget_unapproved'
            ? '真实模型调用预算尚未确认，请联系管理员。'
            : '这项内容暂不支持运行，请查看待确认问题并调整。',
        ),
        ...(!check.trialVerified && !check.issues.some((issue) => issue.code === 'trial_unverified')
          ? ['请完成真实试演，再重新检查。']
          : []),
        ...(!check.mediaVerified && !check.issues.some((issue) => issue.code === 'media_unverified')
          ? ['所用素材尚未核验，请核对后重新检查。']
          : []),
      ]
    : [];
  const needsStartTime = !publicationLocalTime(worldSettings.startAt);
  const scheduleKey = manuscriptFingerprint([
    work?.id,
    work?.draft.version,
    work?.createdAt,
    draftContent,
  ]);
  const visibleSchedule = scheduleReview?.key === scheduleKey ? scheduleReview.schedule : undefined;
  function arrangeTimes() {
    if (!work || busy || !session.canEdit) return;
    setScheduleReview(undefined);
    try {
      const plan = planPublicationTimes(draftContent, { referenceAt: work.createdAt });
      const { updatedContent, ...schedule } = plan;
      const next = plan.status === 'proposed' ? updatedContent : draftContent;
      if (plan.status === 'proposed') setDraftContent(next);
      setScheduleReview({
        key: manuscriptFingerprint([work.id, work.draft.version, work.createdAt, next]),
        schedule,
      });
    } catch {
      setNotice({ type: 'error', message: '本次未能安排时间，当前草稿未修改。请核对内容后重试。' });
    }
  }

  return (
    <div className={s.workbench}>
      {/* ================= Left Sidebar (Works) ================= */}
      <aside className={s.sidebar} aria-label="作品导航">
        <div className={s.sidebarBody}>
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
                  <div key={w.id} className={`${s.workItemRow} ${isActive ? s.activeRow : ''}`}>
                    <button
                      type="button"
                      className={`${s.workItem} ${isActive ? s.active : ''}`}
                      onClick={() => handleSelectWorkSafe(w.id)}
                      aria-current={isActive ? 'page' : undefined}
                      disabled={busy}
                    >
                      <span className={s.workIcon} aria-hidden="true">
                        📄
                      </span>
                      <span className={s.workTitleText}>{w.title}</span>
                    </button>
                    <div className={s.workActions}>
                      <button
                        type="button"
                        className={s.workActionBtn}
                        title={`重命名草稿「${w.title}」`}
                        aria-label={`重命名草稿「${w.title}」`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenRename(w);
                        }}
                        disabled={busy || !session.canEdit}
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        className={`${s.workActionBtn} ${s.workDeleteBtn}`}
                        title={
                          w.status === 'published'
                            ? '已上架作品不可直接删除，请先下架'
                            : `删除草稿「${w.title}」`
                        }
                        aria-label={`删除草稿「${w.title}」`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenDelete(w);
                        }}
                        disabled={busy || !session.canEdit || w.status === 'published'}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
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
              <div className={s.titleRow}>
                <h2 className={s.workTitle}>
                  {work ? draftTitle || work.title : '请在左侧选择或新建世界'}
                </h2>
                {work && (
                  <>
                    <button
                      type="button"
                      className={s.workHeaderActionBtn}
                      title="重命名当前草稿"
                      aria-label="重命名当前草稿"
                      onClick={() => handleOpenRename(work)}
                      disabled={busy || !session.canEdit}
                    >
                      ✏️ 重命名
                    </button>
                    <button
                      type="button"
                      className={`${s.workHeaderActionBtn} ${s.workHeaderDeleteBtn}`}
                      title={
                        work.status === 'published'
                          ? '已上架作品不可直接删除，请先下架'
                          : '删除当前草稿'
                      }
                      aria-label="删除当前草稿"
                      onClick={() => handleOpenDelete(work)}
                      disabled={busy || !session.canEdit || work.status === 'published'}
                    >
                      🗑️ 删除
                    </button>
                  </>
                )}
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
                      ? '已上架'
                      : work.status === 'unpublished'
                        ? '已下架'
                        : '草稿'}
                  </span>
                )}
                {isDirty && <span className={s.dirtyFlag}>未保存</span>}
              </div>
            </div>

            {/* Actions Row */}
            {work && (
              <div className={s.actionsRow}>
                <button
                  type="button"
                  className={`${s.btn} ${s.btnSecondary}`}
                  onClick={handleSaveDraft}
                  disabled={busy || !session.canEdit || !isDirty || overallBlocked}
                  title={
                    !session.canEdit
                      ? '您没有编辑权限'
                      : !isDirty
                        ? '草稿无未保存变更'
                        : '保存当前草稿'
                  }
                >
                  {busy ? '处理中…' : '保存草稿'}
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
                  disabled={busy || !session.canEdit || overallBlocked}
                  onClick={() => {
                    setOverallPreparationText(undefined);
                    setFormPreparationSources(undefined);
                    setFormPreparationScope(undefined);
                    setFormSocialFocus(undefined);
                    setFormSocialActorKey(undefined);
                    setShowMarkdownImport(true);
                  }}
                >
                  导入 Markdown
                </button>

                <button
                  type="button"
                  className={`${s.btn} ${s.btnTrial}`}
                  onClick={
                    onTrial
                      ? () => onTrial({ title: draftTitle, content: draftContent })
                      : undefined
                  }
                  disabled={(busy && !props.draftSaving) || overallBlocked || !onTrial}
                  title={!onTrial ? '试演功能暂不可用' : '以玩家视角试演完整世界故事'}
                >
                  {onTrial ? '试演' : '试演 （暂不可用）'}
                </button>

                <button
                  type="button"
                  className={`${s.btn} ${s.btnPublish}`}
                  onClick={
                    onPublish
                      ? () =>
                          onPublish(
                            isDirty ? { title: draftTitle, content: draftContent } : undefined,
                          )
                      : undefined
                  }
                  disabled={
                    busy ||
                    !onPublish ||
                    !session.canPublish ||
                    overallBlocked ||
                    (!work) ||
                    (activeTab === 'review' &&
                      !isDirty &&
                      check !== null &&
                      (check.status !== 'ready' ||
                        check.workId !== work.id ||
                        check.draftVersion !== work.draftVersion ||
                        check.contentHash !== work.draft.contentHash ||
                        !check.trialVerified ||
                        !check.mediaVerified))
                  }
                  title={
                    !onPublish
                      ? '发布功能暂不可用'
                      : !session.canPublish
                        ? '您没有发布权限'
                        : isDirty
                          ? '保存草稿并检查发布'
                          : check?.status !== 'ready'
                            ? '检查并发布当前故事'
                            : '将当前草稿发布上架'
                  }
                >
                  {busy ? '正在发布…' : onPublish ? '发布' : '发布 （暂不可用）'}
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
                总体设定
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
                剧情发展
              </button>
              {activeTab === 'review' && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={true}
                  className={`${s.tabButton} ${s.activeTab}`}
                  onClick={() => setActiveTab('review')}
                >
                  待确认问题{check && pendingChecks.length > 0 ? `（${pendingChecks.length}）` : ''}
                </button>
              )}
            </div>
          )}
        </header>

        {/* Global Feedback Banners */}
        {markdownReview && activeTab === 'settings' && (
          <details className={s.banner}>
            <summary>本次文稿导入记录 · 原稿与待核对内容</summary>
            <p>此记录仅供当前编辑时核对，不自动保存为世界事实或公开资料。原始文档保持原样。</p>
            <ul>
              {markdownReview.diagnostics.map((item, index) => (
                <li key={index}>
                  {item.filename}：有内容需要核对，请回到导入区查看原文与整理结果。
                </li>
              ))}
            </ul>
            {markdownReview.unmapped.map((item, index) => (
              <details key={index}>
                <summary>{item.filename} · 尚未整理的原文</summary>
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {item.content}
                </pre>
              </details>
            ))}
          </details>
        )}
        {error && (
          <details className={s.feedback}>
            <summary role="alert" className={s.feedbackError}>
              操作未完成，当前编辑内容仍保留 · 查看处理方式
            </summary>
            <p>
              {error.code === 'VERSION_CONFLICT'
                ? '草稿已被其他人更新。你的修改还在，请先核对，不能直接覆盖。'
                : error.code === 'UNAUTHORIZED'
                  ? '登录已失效，请重新登录后再试。'
                  : error.code === 'FORBIDDEN'
                    ? '当前账号没有这项操作的权限，请联系管理员。'
                    : error.code === 'RATE_LIMITED'
                      ? '操作较频繁，请稍后再试。'
                      : error.code === 'INVALID_STATE'
                        ? '故事发布检查未完全就绪。已为您保留当前内容，建议先点击右上角“试演”进行一次手机端体验，或核对故事基本设定后重试。'
                        : '请核对当前故事后重试；如仍无法继续，请联系管理员。是否保存或发布成功，请以重新读取的结果为准。'}
            </p>
          </details>
        )}
        {notice && !error && (
          <div
            className={`${s.feedback} ${
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

        {work && activeTab === 'review' && (
          <section className={s.reviewPanel} aria-label="待确认问题">
            <h3>先核对，再试演与发布</h3>
            <p>
              这里集中核对缺失内容、剧情冲突和试演、发布前需要处理的问题，不会自动修改你的故事。保存草稿后点击顶部“检查”。
            </p>
            {!check ? (
              <p>尚未检查，请先保存草稿，再点击“检查”。</p>
            ) : (
              <>
                {!currentCheck && (
                  <p role="status">以下检查对应旧稿或其他版本，不代表当前编辑稿可以发布。</p>
                )}
                <ol className={s.issueList}>
                  {check.issues.map((issue, index) => (
                    <li key={index}>
                      <p>{issueLabel(issue.path, issue.code)}</p>
                    </li>
                  ))}
                </ol>
                {check.issuesTruncated && (
                  <p role="alert">
                    后台仅返回了部分问题，仍有未列出的项；修正后请重新检查，不代表其余内容已经通过。
                  </p>
                )}
                {check.missingCapabilities.length > 0 && (
                  <section>
                    <h4>当前运行限制</h4>
                    <ul>
                      {check.missingCapabilities.map((capability, index) => (
                        <li key={index}>
                          <p>
                            {capability === 'model_budget_unapproved'
                              ? '真实模型调用预算尚未确认，请联系管理员。'
                              : '这项内容暂不支持运行，需要调整后再检查。'}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {!check.trialVerified &&
                  !check.issues.some((issue) => issue.code === 'trial_unverified') && (
                    <p>尚未完成真实试演验证，请试演角色对话并重新检查。</p>
                  )}
                {!check.mediaVerified &&
                  !check.issues.some((issue) => issue.code === 'media_unverified') && (
                    <p>素材尚未核验，请核对所用图片后重新检查。</p>
                  )}
                {check.status === 'ready' && currentCheck && pendingChecks.length === 0 && (
                  <p>当前已保存稿的检查通过；发布仍以现有权限和操作结果为准。</p>
                )}
                {check.status !== 'ready' && pendingChecks.length === 0 && (
                  <p>后台尚未确认可发布，请重新检查；没有列出问题不代表已经通过。</p>
                )}
              </>
            )}
            {needsStartTime && <p>开场时间待安排或核对，请使用“安排缺省时间”后查看实际结果。</p>}
            <button
              type="button"
              className={`${s.btn} ${s.btnSecondary}`}
              onClick={() => setActiveTab('settings')}
            >
              回总体设定核对与编辑
            </button>
          </section>
        )}

        {work && activeTab === 'review' && (
          <details className={s.scheduling} aria-label="安排故事时间">
            <summary>故事时间（按需安排）</summary>
            <button
              type="button"
              className={`${s.btn} ${s.btnSecondary}`}
              disabled={busy || !session.canEdit}
              onClick={arrangeTimes}
            >
              安排缺省时间
            </button>
            <p>按当前故事补齐缺省时间，保留已有明确日期；只修改编辑稿，不会自动保存或试演。</p>
            {visibleSchedule && (
              <PublisherScheduleReview
                schedule={visibleSchedule}
                content={draftContent}
                context="draft"
              />
            )}
          </details>
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

        {work && activeTab === 'settings' && (
          <section className={s.overallSetting} id="writer-overall-setting" aria-label="总体设定">
            <label className={s.fieldLabel} htmlFor="work-title-input">
              作品标题
            </label>
            <input
              id="work-title-input"
              className={s.input}
              value={worldSettings.title}
              onChange={(e) => handleWorldSettingsChange('title', e.target.value)}
              placeholder="给这段故事起个名字"
              disabled={!session.canEdit || busy}
            />
            <h3>
              <label htmlFor="writer-overall-text">总体设定</label>
            </h3>
            <p className={s.fieldHint}>
              把背景、人物处境、矛盾和你想探索的可能性写在这里。整理出的内容核对后再保存、试演和发布。
            </p>
            {overall.source === 'existing' && overallInput === undefined && (
              <p className={s.overallNotice}>
                以下是从既有设定汇总的回顾，不是原始文稿。可以从这里改写；未编辑前不会另存一份原稿。
              </p>
            )}
            <textarea
              id="writer-overall-text"
              className={`${s.textarea} ${s.overallTextarea}`}
              rows={12}
              value={overallText}
              disabled={!session.canEdit || busy}
              onChange={(event) => changeOverall(event.target.value)}
              placeholder="在这里写下你的世界和故事想法…"
              aria-describedby="writer-overall-help"
            />
            <p id="writer-overall-help" className={s.fieldHint}>
              已输入 {Array.from(overallText).length} 字。编辑后请保存；不会自动整理或发布。
            </p>
            {overallMessage && (
              <p role="alert" className={s.overallNotice}>
                {overallMessage}
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`${s.btn} ${s.btnPrimary}`}
                disabled={
                  busy ||
                  !session.canEdit ||
                  !props.preparationClient ||
                  !overallText.trim() ||
                  !overallUpdate.ok
                }
                onClick={() => onPrepareOverall(overallText)}
              >
                AI 帮写
              </button>
            </div>
          </section>
        )}
        {/* ================= Tab 2: 人物 ================= */}
        {work && activeTab === 'actors' && (
          <div className={s.actorWorkspace}>
            {/* 顶部横排角色栏：最左侧新建角色，右侧横排角色列表 */}
            <div className={s.actorTopNav} aria-label="角色导航栏">
              <button
                type="button"
                className={s.createActorTopBtn}
                onClick={handleAddActor}
                disabled={!session.canEdit || busy}
              >
                + 新建角色
              </button>
              <div className={s.actorScrollList} role="tablist" aria-orientation="horizontal">
                {actorList.length === 0 ? (
                  <p className={s.configNotice}>尚无角色，点击左侧「+ 新建角色」</p>
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
                        className={`${s.actorScrollItem} ${isSelected ? s.activeActorScrollItem : ''}`}
                        onClick={() => setSelectedActorKey(a.key)}
                      >
                        <span className={s.actorScrollName}>{a.name || '未命名'}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* 下方角色详细信息与手机对话框 */}
            {currentActorForm ? (
              <div className={s.actorContentGrid}>
                {/* 左侧：角色信息与核心维度 */}
                <div className={s.card}>
                  <div className={s.sectionHeader}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <h3 className={s.sectionTitle}>
                        角色设定 · {currentActorForm.name || '未命名'}
                      </h3>
                      <span
                        style={{
                          fontSize: '12px',
                          color: isDirty ? '#d97706' : '#16a34a',
                          background: isDirty ? '#fef3c7' : '#dcfce7',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          fontWeight: 500,
                        }}
                      >
                        {busy ? '正在保存…' : isDirty ? '填写即自动保存' : '已自动保存'}
                      </span>
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

                  {(() => {
                    const defaultAvatarArtKey =
                      PUBLICATION_ART.filter((a) => a.uses.includes('avatar'))[0]?.key ??
                      'qingqing';
                    const activeAvatarKey = currentActorForm.avatarMediaKey || defaultAvatarArtKey;
                    const avatarImgUrl = publisherArtUrl(draftContent, activeAvatarKey, 'avatar');

                    return (
                      <div className={s.formGrid}>
                        {/* 1. 姓名 */}
                        <div className={s.formFieldFull}>
                          <label className={s.fieldLabel} htmlFor="character-author-name">
                            人物姓名
                          </label>
                          <input
                            id="character-author-name"
                            className={s.input}
                            value={currentActorForm.name}
                            maxLength={80}
                            disabled={busy || !session.canEdit}
                            onChange={(event) =>
                              handleActorChange('name', event.currentTarget.value)
                            }
                            placeholder="输入角色姓名（如：林白语、苏青）"
                          />
                        </div>

                        {/* 2. 微信头像：当前只提供可真正发布的预设素材。 */}
                        <div className={s.formFieldFull}>
                          <label className={s.fieldLabel}>微信头像（可发布的预设图片）</label>
                          <div className={s.avatarSettingBox}>
                            <div className={s.avatarPreviewThumb}>
                              {avatarImgUrl ? (
                                <img
                                  src={avatarImgUrl}
                                  alt=""
                                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                              ) : (
                                getAvatarChar(currentActorForm.name)
                              )}
                            </div>
                            <div className={s.avatarControls}>
                              <div className={s.avatarMethodRow} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <select
                                  id="publication-avatar"
                                  className={s.avatarSelectInput}
                                  disabled={!session.canEdit || busy}
                                  value={activeAvatarKey}
                                  onChange={(e) => handleArtChange('avatar', e.target.value)}
                                  aria-label="选择预设默认图片"
                                >
                                  {PUBLICATION_ART.filter((a) => a.uses.includes('avatar')).map(
                                    (a) => (
                                      <option key={a.key} value={a.key}>
                                        默认图片：{a.label}
                                      </option>
                                    ),
                                  )}
                                  {activeAvatarKey &&
                                    !PUBLICATION_ART.some((a) => a.key === activeAvatarKey) && (
                                      <option value={activeAvatarKey}>已导入自定义头像</option>
                                    )}
                                </select>
                                <label
                                  className={`${s.btn} ${s.btnSecondary}`}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    cursor: !session.canEdit || busy ? 'not-allowed' : 'pointer',
                                    fontSize: 13,
                                    padding: '4px 10px',
                                    margin: 0,
                                  }}
                                  title="从本地导入图片作为角色微信头像"
                                >
                                  <span>导入头像图片</span>
                                  <input
                                    type="file"
                                    accept="image/*"
                                    style={{ display: 'none' }}
                                    disabled={!session.canEdit || busy}
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (!file) return;
                                      const reader = new FileReader();
                                      reader.onload = (event) => {
                                        const dataUrl = event.target?.result as string;
                                        if (dataUrl) {
                                          handleCustomAvatarImport(dataUrl);
                                        }
                                      };
                                      reader.readAsDataURL(file);
                                      e.target.value = '';
                                    }}
                                  />
                                </label>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className={s.formFieldFull}>
                          <label className={s.fieldLabel} htmlFor="actor-identity-input">
                            公开身份（玩家可见）
                          </label>
                          <input
                            id="actor-identity-input"
                            className={s.input}
                            value={currentActorForm.identity}
                            onChange={(e) => handleActorChange('identity', e.target.value)}
                            placeholder="角色的职业或身份"
                            disabled={!session.canEdit || busy}
                          />
                        </div>
                        <div className={s.formFieldFull}>
                          <label className={s.fieldLabel} htmlFor="actor-introduction-input">
                            公开角色介绍（玩家可见）
                          </label>
                          <textarea
                            id="actor-introduction-input"
                            className={s.textarea}
                            rows={3}
                            value={characterIntroductionText(draftContent, currentActorForm.key)}
                            onChange={(e) =>
                              handleCharacterFieldChange('introduction', e.target.value)
                            }
                            placeholder="编剧写给玩家看的角色介绍"
                            disabled={
                              !session.canEdit ||
                              busy ||
                              !characterFieldEditable(
                                draftContent,
                                currentActorForm.key,
                                'introduction',
                              )
                            }
                          />
                        </div>

                        <div className={s.formFieldFull}>
                          <div className={s.dimensionSection}>
                            <div className={s.dimensionHeader}>
                              <h4 className={s.dimensionTitle}>角色核心 5 个维度设定</h4>
                              <span className={s.dimensionHint}>仅供角色演绎，不向玩家展示</span>
                            </div>
                            {CHARACTER_MODULES.map((module, index) => {
                              const legacy = characterLegacyModuleText(
                                draftContent,
                                currentActorForm.key,
                                module.key,
                              );
                              return (
                                <div className={s.formFieldFull} key={module.key}>
                                  <label
                                    className={s.fieldLabel}
                                    htmlFor={`actor-dimension-${index + 1}`}
                                  >
                                    {module.label}（{module.hint}）
                                  </label>
                                  <textarea
                                    id={`actor-dimension-${index + 1}`}
                                    className={s.textarea}
                                    rows={3}
                                    value={characterModuleText(
                                      draftContent,
                                      currentActorForm.key,
                                      module.key,
                                    )}
                                    onChange={(e) =>
                                      handleCharacterFieldChange(module.key, e.target.value)
                                    }
                                    placeholder={`填写人物的${module.label}`}
                                    disabled={
                                      !session.canEdit ||
                                      busy ||
                                      !characterFieldEditable(
                                        draftContent,
                                        currentActorForm.key,
                                        module.key,
                                      )
                                    }
                                  />
                                  {legacy && (
                                    <details>
                                      <summary>查看保留的旧版设定</summary>
                                      <p style={{ whiteSpace: 'pre-wrap' }}>{legacy}</p>
                                      <p>仅供参考；填写上方内容后使用新的设定，旧文稿保持不变。</p>
                                    </details>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* 右侧：手机界面与对话框 */}
                <div className={s.characterPreviewContainer}>
                  <PublisherCharacterSocialEditor
                    content={draftContent}
                    actorKey={currentActorForm.key}
                    referenceAt={work.createdAt}
                    canEdit={session.canEdit}
                    busy={busy}
                    onChange={setDraftContent}
                  />
                  <PublisherCharacterPreview
                    content={draftContent}
                    actorKey={currentActorForm.key}
                    canEdit={session.canEdit}
                    busy={busy}
                    isDirty={isDirty}
                    saveBlocked={overallBlocked}
                    trial={
                      phoneTrialMatches(work, props.characterTrial) ? props.characterTrial : null
                    }
                    trialMessage={props.characterTrialMessage}
                    trialError={props.characterTrialError}
                    allowTrialWhileSaving={props.draftSaving}
                    onStartTrial={handleCharacterTrial}
                    onSave={handleSaveDraft}
                    onCloseTrial={props.onCloseCharacterTrial}
                    onGenerate={
                      props.preparationClient
                        ? (focus) => onGenerateCharacterSocial(currentActorForm.key, focus)
                        : undefined
                    }
                    generatingFocus={socialGenerating}
                    generationMessage={socialGenerationMessage}
                    generationError={socialGenerationError}
                    onChange={setDraftContent}
                  />
                </div>
              </div>
            ) : (
              <div className={s.emptyState}>
                <p>请在上方选择或新建一个角色开始创作。</p>
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
                <li key={idx}>
                  {(
                    {
                      relationship: '人际关系仍在使用这个人物',
                      message: '开场消息仍在使用这个人物',
                      moments: '朋友圈动态仍在使用这个人物',
                      invitation: '日历约定仍在使用这个人物',
                      history: '过去经历仍在使用这个人物',
                      candidate: '后续剧情仍在使用这个人物',
                    } as Record<string, string>
                  )[ref.category] ?? '其他故事内容仍与这个人物有关联'}
                </li>
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
          preparationClient={props.preparationClient}
          workId={work.id}
          version={work.draft.version}
          referenceAt={work.createdAt}
          content={draftContent}
          disabled={busy || !session.canEdit}
          initialOverallText={overallPreparationText}
          initialSources={formPreparationSources}
          initialScope={formPreparationScope}
          initialSocialFocus={formSocialFocus}
          initialSocialActorKey={formSocialActorKey}
          onClose={() => {
            setShowMarkdownImport(false);
            setOverallPreparationText(undefined);
            setFormPreparationSources(undefined);
            setFormPreparationScope(undefined);
            setFormSocialFocus(undefined);
            setFormSocialActorKey(undefined);
          }}
          onApply={(next, summary, options?: { keepOpen?: boolean }) => {
            if (overallBlocked) return;
            setOverallInput(undefined);
            setOverallPreparationText(undefined);
            setFormPreparationSources(undefined);
            setFormPreparationScope(undefined);
            setFormSocialFocus(undefined);
            setFormSocialActorKey(undefined);
            setDraftContent(next);
            setActiveTab(formPreparationScope === 'characters' ? 'actors' : 'settings');
            setSettingsOpen(false);
            setShowMarkdownImport(!!options?.keepOpen);
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

      {/* Rename Work Modal */}
      {renamingWork && (
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
          aria-labelledby="rename-work-title"
        >
          <form
            onSubmit={handleRenameSubmit}
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
            <h3 id="rename-work-title" style={{ margin: 0, fontSize: 18 }}>
              重命名草稿作品
            </h3>
            <div className={s.formField}>
              <label className={s.fieldLabel} htmlFor="rename-work-input">
                作品新名称
              </label>
              <input
                id="rename-work-input"
                className={s.input}
                value={renameTitle}
                onChange={(e) => setRenameTitle(e.target.value)}
                placeholder="请输入作品名称"
                maxLength={80}
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className={`${s.btn} ${s.btnSecondary}`}
                onClick={() => setRenamingWork(null)}
              >
                取消
              </button>
              <button
                type="submit"
                className={`${s.btn} ${s.btnPrimary}`}
                disabled={busy || !session.canEdit || !renameTitle.trim()}
              >
                确认重命名
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Work Modal */}
      {deletingWork && (
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
          aria-labelledby="delete-work-title"
        >
          <div
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
            <h3 id="delete-work-title" style={{ margin: 0, fontSize: 18, color: '#dc2626' }}>
              删除草稿作品
            </h3>
            <p style={{ margin: 0, fontSize: 14, color: '#4b5563', lineHeight: 1.6 }}>
              确定要删除草稿<strong>「{deletingWork.title}」</strong>吗？删除后该草稿将移出工作台。
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button
                type="button"
                className={`${s.btn} ${s.btnSecondary}`}
                onClick={() => setDeletingWork(null)}
              >
                取消
              </button>
              <button
                type="button"
                className={`${s.btn} ${s.btnDanger}`}
                onClick={handleDeleteConfirm}
                disabled={busy || !session.canEdit}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
