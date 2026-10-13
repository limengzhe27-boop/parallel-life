import { conditionChoices } from './publisher-condition-model.ts';
import {
  plotArray,
  plotRecord,
  plotText,
  plotStrings,
  plotRows,
  plotRowEditable,
  plotName,
  plotConditionText,
  plotOutcomeLabel,
  plotTimeLabel,
} from './publisher-plot-model.ts';

export type StoryGraphNode = {
  key: string;
  conditionKey?: string;
  title: string;
  stageKey?: string;
  stageLabel: string;
  intentLabel: string;
  conditions: string[];
  editable: boolean;
};
export type StoryGraphEdge = {
  key: string;
  from: string;
  to: string;
  label: string;
  kind: 'prerequisite' | 'alternative' | 'exclusion' | 'stage';
};
export type StoryGraphStage = { key: string; label: string; order: number };
export type StoryGraph = {
  nodes: StoryGraphNode[];
  edges: StoryGraphEdge[];
  stages: StoryGraphStage[];
  warnings: string[];
};
/** Authoring projection only. No clock, eligibility evaluation, default dependency or draft mutation. */
export function buildStoryGraph(raw: Record<string, unknown>): StoryGraph {
  const content = plotRecord(raw);
  const warnings = new Set<string>();
  const strings = (value: unknown, label: string) => {
    if (
      value !== undefined &&
      (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    )
      warnings.add(`${label}格式待核对，未猜测缺失内容。`);
    return plotStrings(value);
  };
  const candidateRows = plotRows(content, 'candidates');
  const stageRows = plotRows(content, 'stages');
  if (content.candidates !== undefined && !Array.isArray(content.candidates))
    warnings.add('剧情列表格式待核对，原稿未修改。');
  if (
    content.timeline !== undefined &&
    (content.timeline === null ||
      typeof content.timeline !== 'object' ||
      Array.isArray(content.timeline) ||
      !Array.isArray(plotRecord(content.timeline).stages))
  )
    warnings.add('阶段列表尚未填写完整，原稿未修改。');
  const stages: StoryGraphStage[] = stageRows
    .flatMap((raw, index) => {
      const stage = plotRecord(raw),
        key = plotText(stage.key);
      if (
        !plotRowEditable(content, 'stages', key) ||
        typeof stage.order !== 'number' ||
        !Number.isFinite(stage.order)
      ) {
        warnings.add(`第${index + 1}个阶段的名称关联或顺序待核对，暂不分列。`);
        return [];
      }
      return [{ key, label: plotText(stage.title) || '未命名阶段', order: stage.order }];
    })
    .sort((a, b) => a.order - b.order);
  const nodes: StoryGraphNode[] = candidateRows.map((raw, index) => {
    const row = plotRecord(raw),
      key = plotText(row.key),
      editable = plotRowEditable(content, 'candidates', key);
    if (!editable) warnings.add(`第${index + 1}个事件的关联信息缺失或重复，请先核对原稿。`);
    const stageKey = plotText(plotRecord(row.timeline).stageKey);
    return {
      key: editable ? key : `display:event:${index}`,
      title: plotText(row.title) || `未命名事件 ${index + 1}`,
      ...(stageKey && stages.some((s) => s.key === stageKey) ? { stageKey } : {}),
      stageLabel: stageKey ? plotName(content, 'stages', stageKey) : '未分阶段',
      intentLabel: (() => {
        const labels = {
          offer_message: '角色来信',
          offer_invitation: '发出邀约',
          editorial_only: '导演建议（仅备注，不自动执行）',
          director_event: '由导演择机演绎，也可暂缓',
        };
        const kind = plotText(plotRecord(row.intent).kind);
        return Object.hasOwn(labels, kind) ? labels[kind as keyof typeof labels] : '剧情方式待核对';
      })(),
      conditions: [],
      editable,
    };
  });
  const target = (key: unknown) =>
    typeof key === 'string' ? nodes.find((n) => n.editable && n.key === key) : undefined;
  const edges: StoryGraphEdge[] = [];
  const edge = (
    from: StoryGraphNode | undefined,
    to: StoryGraphNode | undefined,
    kind: StoryGraphEdge['kind'],
    label: string,
  ) => {
    if (!from || !to || !from.editable || !to.editable) {
      warnings.add('部分剧情关联缺失或不明确，未猜测连线，请核对原稿。');
      return;
    }
    const key = JSON.stringify([from.key, to.key, kind, label]);
    if (!edges.some((e) => e.key === key))
      edges.push({ key, from: from.key, to: to.key, kind, label });
  };
  const windowDescription = (raw: unknown, label: string) => {
    const window = plotRecord(raw);
    return `${label}：${plotTimeLabel(window.notBefore)}至${plotTimeLabel(window.expiresAt)}（开始包含，到期不包含）`;
  };
  const inboundAlternatives = new Map<string, string[]>();
  for (const [index, raw] of candidateRows.entries()) {
    const row = plotRecord(raw),
      node = nodes[index]!,
      timeline = plotRecord(row.timeline);
    const stageKey = plotText(timeline.stageKey);
    if (stageKey) {
      const matched = stageRows.map(plotRecord).filter((s) => s.key === stageKey);
      if (matched.length === 1) {
        const stage = matched[0]!;
        node.conditions.push(
          `所属阶段「${plotName(content, 'stages', stageKey)}」须处于可推进状态`,
        );
        for (const prior of strings(stage.afterStageKeys, '部分阶段的先后关系'))
          node.conditions.push(
            `等待前置阶段「${plotName(content, 'stages', prior)}」结束；不要求其中每个事件都成功`,
          );
        if (stage.afterStageKeys !== undefined && !Array.isArray(stage.afterStageKeys))
          warnings.add('部分阶段的先后关系格式待核对。');
        if (stage.window !== undefined)
          node.conditions.push(windowDescription(stage.window, '阶段日期限制'));
      } else {
        node.conditions.push('所属阶段待核对');
        warnings.add('部分事件的所属阶段不存在或不唯一。');
      }
    }
    if (row.placeKey !== undefined)
      node.conditions.push(`玩家位于「${plotName(content, 'places', row.placeKey)}」`);
    if (timeline.window !== undefined)
      node.conditions.push(windowDescription(timeline.window, '事件日期限制'));
    const prerequisites = plotArray(row.prerequisites);
    if (row.prerequisites !== undefined && !Array.isArray(row.prerequisites)) {
      node.conditions.push('出现条件列表格式待核对');
      warnings.add('部分事件的出现条件列表格式待核对。');
    }
    for (const rawCondition of prerequisites) {
      const condition = plotRecord(rawCondition);
      if (condition.kind === 'after_resolved_node') strings(condition.outcomes, '部分前置结果');
      const label = plotConditionText(content, condition);
      node.conditions.push(label);
      if (
        condition.kind === 'after_presented_node' ||
        condition.kind === 'after_committed_node' ||
        condition.kind === 'after_resolved_node'
      )
        edge(target(condition.nodeKey), node, 'prerequisite', label);
      else if (!['history_fact', 'at_place', 'not_before'].includes(plotText(condition.kind)))
        warnings.add('部分出现条件暂不支持，原文保留，请在编辑区核对。');
    }
    for (const key of strings(row.mutuallyExclusiveNodeKeys, '部分互斥安排')) {
      const label = `「${plotName(content, 'candidates', key)}」${plotOutcomeLabel(content, key, 'committed')}后，本事件不再出现`;
      node.conditions.push(label);
      edge(target(key), node, 'exclusion', label);
    }
    if (
      row.mutuallyExclusiveNodeKeys !== undefined &&
      !Array.isArray(row.mutuallyExclusiveNodeKeys)
    )
      warnings.add('部分互斥安排格式待核对。');
    for (const item of plotArray(timeline.excludeIfResolved)) {
      const rule = plotRecord(item);
      const outcomes =
        strings(rule.outcomes, '部分排除结果')
          .map((o) => plotOutcomeLabel(content, rule.nodeKey, o))
          .join(' / ') || '结果尚未选择';
      const label = `「${plotName(content, 'candidates', rule.nodeKey)}」出现任一结果（${outcomes}）后，本事件不再出现`;
      node.conditions.push(label);
      edge(target(rule.nodeKey), node, 'exclusion', label);
    }
    if (timeline.excludeIfResolved !== undefined && !Array.isArray(timeline.excludeIfResolved))
      warnings.add('部分不再出现的条件格式待核对。');
    if (
      timeline.alternatives !== undefined &&
      plotRecord(timeline.alternatives) !== timeline.alternatives
    )
      warnings.add('部分替代走向格式待核对，原稿未修改。');
    if (row.timeline !== undefined && plotRecord(row.timeline) !== row.timeline)
      warnings.add('部分事件的阶段安排格式待核对，原稿未修改。');
    const alternatives = plotRecord(timeline.alternatives);
    for (const [field, outcome] of [
      ['onDeclined', 'declined'],
      ['onSkipped', 'skipped'],
      ['onExpired', 'expired'],
    ] as const) {
      if (alternatives[field] !== undefined && !Array.isArray(alternatives[field]))
        warnings.add('部分替代走向格式待核对。');
      for (const key of strings(alternatives[field], '部分替代走向')) {
        const to = target(key),
          result = plotOutcomeLabel(content, row.key, outcome);
        edge(node, to, 'alternative', `${result}后可考虑；仍须满足该事件自身条件`);
        if (to && node.editable) {
          const values = inboundAlternatives.get(to.key) ?? [];
          values.push(`「${node.title}」${result}`);
          inboundAlternatives.set(to.key, values);
        }
      }
    }
  }
  const groups = conditionChoices(content);
  if (content.conditions !== undefined && !Array.isArray(content.conditions))
    warnings.add('独立条件列表待核对，原稿未修改。');
  if (plotArray(content.conditions).length !== groups.length)
    warnings.add('部分独立条件的关联缺失或重复，请先核对。');
  const conditionNodes: StoryGraphNode[] = groups.map((group) => {
    const row = plotArray(content.conditions)
      .map(plotRecord)
      .find((r) => r.key === group.key)!;
    const terms = plotArray(row.prerequisites);
    if (!terms.length || !['all', 'any'].includes(plotText(row.match)))
      warnings.add('部分独立条件还没有填写完整，不会放行事件。');
    const node: StoryGraphNode = {
      key: `condition:${group.key}`,
      conditionKey: group.key,
      title: group.label,
      stageKey: '__conditions',
      stageLabel: '独立条件',
      editable: true,
      intentLabel: row.match === 'any' ? '条件 · 任一满足' : '条件 · 全部满足',
      conditions: [
        row.match === 'any' ? '以下任意一项满足即可' : '以下条件需要全部满足',
        ...terms.map((p) => plotConditionText(content, p)),
      ],
    };
    for (const term of terms.map(plotRecord))
      if (
        term.kind === 'after_presented_node' ||
        term.kind === 'after_committed_node' ||
        term.kind === 'after_resolved_node'
      )
        edge(target(term.nodeKey), node, 'prerequisite', plotConditionText(content, term));
    return node;
  });
  for (const [index, raw] of candidateRows.entries()) {
    for (const key of strings(plotRecord(raw).conditionKeys, '关联的独立条件')) {
      const group = conditionNodes.find((n) => n.conditionKey === key);
      edge(
        group,
        nodes[index],
        'prerequisite',
        `条件「${group?.title ?? '待核对'}」满足后才可发生`,
      );
      nodes[index]!.conditions.push(`独立条件「${group?.title ?? '待核对'}」须满足`);
    }
  }
  for (const node of nodes) {
    const inbound = inboundAlternatives.get(node.key);
    if (inbound?.length) node.conditions.push(`替代入口（任一满足）：${inbound.join('；')}`);
    if (node.conditions.some((text) => /待核对|待补齐|尚未选择/.test(text)))
      warnings.add('部分事件条件尚未完整，请在编辑区核对。');
    if (node.conditions.length)
      node.conditions.unshift(
        '出现要求须全部满足；同一项结果或替代入口任选其一，排除情况会阻止出现',
      );
  }
  return { nodes: [...conditionNodes, ...nodes], edges, stages, warnings: [...warnings] };
}
