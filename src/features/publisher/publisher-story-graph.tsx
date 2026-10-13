'use client';

import { useId, useState } from 'react';
import { buildStoryGraph, type StoryGraph } from './publisher-story-graph-model.ts';
import s from './publisher-story-graph.module.css';

export type PublisherStoryGraphProps = {
  content: Record<string, unknown>;
  disabled: boolean;
  onSelect: (key: string) => void;
};
const cardWidth = 258;
const cardHeight = 164;
const columnGap = 122;
const rowGap = 76;
/** Layout is presentation only: never creates or edits story dependencies. */
export function layoutStoryGraph(graph: StoryGraph) {
  const groups = graph.stages.map((stage) => ({ key: stage.key, label: stage.label }));
  for (const node of graph.nodes) {
    const key = node.stageKey ?? '';
    if (!groups.some((group) => group.key === key))
      groups.push({ key, label: node.stageLabel || '未分阶段' });
  }
  const counts = new Map<string, number>();
  const positioned = graph.nodes.map((node) => {
    const key = node.stageKey ?? '';
    const row = counts.get(key) ?? 0;
    counts.set(key, row + 1);
    return {
      ...node,
      x: 64 + groups.findIndex((group) => group.key === key) * (cardWidth + columnGap),
      y: 72 + row * (cardHeight + rowGap),
    };
  });
  return {
    groups,
    nodes: positioned,
    width: Math.max(1, groups.length) * (cardWidth + columnGap) + 6,
    height: Math.max(1, ...counts.values()) * (cardHeight + rowGap) + 50,
  };
}
const edgeNames = {
  prerequisite: '发生条件',
  alternative: '另一种发展',
  exclusion: '排除关系',
  stage: '阶段先后',
};

export function PublisherStoryGraph({ content, disabled, onSelect }: PublisherStoryGraphProps) {
  const graph = buildStoryGraph(content);
  const layout = layoutStoryGraph(graph);
  const [selectedKey, setSelectedKey] = useState<string>();
  const marker = useId().replaceAll(':', '');
  const selected = graph.nodes.find((node) => node.key === selectedKey);
  const related = graph.edges.filter(
    (edge) => edge.from === selectedKey || edge.to === selectedKey,
  );
  const title = (key: string) =>
    graph.nodes.find((node) => node.key === key)?.title ?? '待核对事件';
  return (
    <section className={s.root} aria-label="剧情流程图">
      <div className={s.heading}>
        <div>
          <h3>剧情流程图</h3>
          <p>先看故事的走向，再点事件查看条件和编辑内容。</p>
        </div>
        <span className={s.count}>{graph.nodes.length} 个事件</span>
      </div>
      <p className={s.note}>
        连线表示发生条件或可能的发展，不代表事件一定发生。满足全部条件后，由导演结合当前情况安排。
      </p>
      {graph.warnings.length > 0 && (
        <details className={s.warnings}>
          <summary>有 {graph.warnings.length} 处关联需要核对</summary>
          <ul>
            {graph.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
      {!graph.nodes.length ? (
        <p className={s.empty}>
          还没有剧情事件。先在下方新增事件，设置出现条件后，这里会自动连线。
        </p>
      ) : (
        <>
          <div className={s.legend}>
            <span>实线：发生条件</span>
            <span>虚线：另一种发展</span>
            <span>点线：排除关系</span>
            <span>左右滑动查看完整故事</span>
          </div>
          <div className={s.scroll} tabIndex={0} role="region" aria-label="可横向滚动的剧情画布">
            <div className={s.canvas} style={{ width: layout.width, height: layout.height }}>
              {layout.groups.map((group, i) => (
                <div
                  key={group.key}
                  className={s.stage}
                  style={{ left: 64 + i * (cardWidth + columnGap), width: cardWidth }}
                >
                  {group.label}
                </div>
              ))}
              <svg
                className={s.lines}
                width={layout.width}
                height={layout.height}
                aria-hidden="true"
              >
                <defs>
                  {['prerequisite', 'alternative', 'exclusion', 'stage'].map((kind) => (
                    <marker
                      key={kind}
                      id={`${marker}-${kind}`}
                      markerWidth="8"
                      markerHeight="8"
                      refX="7"
                      refY="4"
                      orient="auto"
                    >
                      <path
                        d="M0,0 L8,4 L0,8 z"
                        fill={
                          kind === 'exclusion'
                            ? '#ad5c67'
                            : kind === 'alternative'
                              ? '#9b7835'
                              : '#7186a8'
                        }
                      />
                    </marker>
                  ))}
                </defs>
                {graph.edges.map((edge, i) => {
                  const from = layout.nodes.find((node) => node.key === edge.from);
                  const to = layout.nodes.find((node) => node.key === edge.to);
                  if (!from || !to) return null;
                  const sameColumn = from.x === to.x;
                  const forward = to.x > from.x;
                  const x1 = sameColumn ? from.x : from.x + (forward ? cardWidth : 0);
                  const x2 = sameColumn ? to.x : to.x + (forward ? 0 : cardWidth);
                  const y1 = from.y + cardHeight / 2;
                  const y2 = to.y + cardHeight / 2;
                  const bend = sameColumn ? from.x - 30 - (i % 3) * 9 : (x1 + x2) / 2;
                  const d =
                    sameColumn && from.key === to.key
                      ? `M ${x1} ${y1 - 24} C ${bend - 20} ${y1 - 70}, ${bend - 20} ${y1 + 70}, ${x2} ${y2 + 24}`
                      : `M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}`;
                  const active =
                    !selectedKey || edge.from === selectedKey || edge.to === selectedKey;
                  return (
                    <g key={edge.key} opacity={active ? 1 : 0.18}>
                      <path
                        d={d}
                        fill="none"
                        stroke={
                          edge.kind === 'exclusion'
                            ? '#ad5c67'
                            : edge.kind === 'alternative'
                              ? '#9b7835'
                              : '#7186a8'
                        }
                        strokeWidth={selectedKey && active ? 2.5 : 1.5}
                        strokeDasharray={
                          edge.kind === 'alternative'
                            ? '7 5'
                            : edge.kind === 'exclusion'
                              ? '2 5'
                              : undefined
                        }
                        markerEnd={`url(#${marker}-${edge.kind})`}
                      />
                    </g>
                  );
                })}
              </svg>
              {layout.nodes.map((node) => (
                <button
                  key={node.key}
                  type="button"
                  className={`${s.node} ${node.key === selectedKey ? s.selected : ''}`}
                  style={{ left: node.x, top: node.y, width: cardWidth, height: cardHeight }}
                  aria-pressed={node.key === selectedKey}
                  onClick={() => setSelectedKey(node.key)}
                >
                  <span className={s.kind}>{node.intentLabel}</span>
                  <strong>{node.title}</strong>
                  <span className={s.condition}>
                    {node.conditions.find((text) => !text.startsWith('出现要求须全部满足')) ||
                      '未额外限定出现条件'}
                  </span>
                  <span className={s.more}>查看完整条件与关系</span>
                </button>
              ))}
            </div>
          </div>
          {selected ? (
            <div className={s.inspector} aria-live="polite">
              <div className={s.heading}>
                <div>
                  <span className={s.kind}>
                    {selected.stageLabel} · {selected.intentLabel}
                  </span>
                  <h4>{selected.title}</h4>
                </div>
                <button
                  type="button"
                  className={s.edit}
                  disabled={disabled || !selected.editable}
                  onClick={() => onSelect(selected.key)}
                >
                  编辑此事件
                </button>
              </div>
              <strong>什么时候可以考虑发生</strong>
              {selected.conditions.length ? (
                <ul>
                  {selected.conditions.map((condition, i) => (
                    <li key={i}>{condition}</li>
                  ))}
                </ul>
              ) : (
                <p>没有额外出现条件，仍受故事阶段、人物状态和导演安排约束。</p>
              )}
              {related.length > 0 && (
                <>
                  <strong>与其他事件的关系</strong>
                  <ul>
                    {related.map((edge) => (
                      <li key={edge.key}>
                        <b>{title(edge.from)}</b> → <b>{title(edge.to)}</b>：{edge.label}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : (
            <p className={s.prompt}>点一张事件卡，可查看完整触发条件、分路和排除关系。</p>
          )}
          {graph.edges.length > 0 && (
            <details className={s.connections}>
              <summary>查看全部连线说明（{graph.edges.length}）</summary>
              <ul>
                {graph.edges.map((edge) => (
                  <li key={edge.key}>
                    <span>{edgeNames[edge.kind]}</span>{' '}
                    <button type="button" onClick={() => setSelectedKey(edge.from)}>
                      {title(edge.from)}
                    </button>{' '}
                    →{' '}
                    <button type="button" onClick={() => setSelectedKey(edge.to)}>
                      {title(edge.to)}
                    </button>
                    <p>{edge.label}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
