'use client';

import { useMemo, useState } from 'react';
import { buildPublicationSourceReview } from '../../modules/settings/domain/publication-source-review.ts';
import type {
  ManuscriptSource,
  SourceReviewRow,
  SourceReviewTarget,
} from '../../modules/settings/domain/publication-source-review-types.ts';
import s from './publisher-source-review.module.css';

function boundary(text: string, offset: number) {
  if (offset <= 0 || offset >= text.length) return true;
  return !(
    text.charCodeAt(offset - 1) >= 0xd800 &&
    text.charCodeAt(offset - 1) <= 0xdbff &&
    text.charCodeAt(offset) >= 0xdc00 &&
    text.charCodeAt(offset) <= 0xdfff
  );
}
/** Only exact slices of the current source can be presented as located original text. */
export function locateSourceReviewRow(sources: ManuscriptSource[], row: SourceReviewRow) {
  const source = Number.isInteger(row.fileIndex) ? sources[row.fileIndex] : undefined;
  if (
    !source ||
    source.filename !== row.filename ||
    !Number.isInteger(row.start) ||
    !Number.isInteger(row.end) ||
    row.start < 0 ||
    row.end <= row.start ||
    row.end > source.content.length ||
    !boundary(source.content, row.start) ||
    !boundary(source.content, row.end)
  )
    return null;
  const quote = source.content.slice(row.start, row.end);
  const line = source.content.slice(0, row.start).split(/\r\n|\r|\n/).length;
  if (quote !== row.quote || line !== row.line) return null;
  let contextStart = Math.max(0, row.start - 200);
  let contextEnd = Math.min(source.content.length, row.end + 200);
  if (!boundary(source.content, contextStart)) contextStart++;
  if (!boundary(source.content, contextEnd)) contextEnd--;
  return {
    filename: source.filename,
    line,
    quote,
    contextStart,
    contextEnd,
    beforeTruncated: contextStart > 0,
    afterTruncated: contextEnd < source.content.length,
    before: source.content.slice(contextStart, row.start),
    after: source.content.slice(row.end, contextEnd),
  };
}
type ReviewMode = 'needs' | 'unresolved' | 'covered' | 'all';
export function sourceReviewAssessment(row: SourceReviewRow, sources: ManuscriptSource[]) {
  if (!locateSourceReviewRow(sources, row))
    return { kind: 'unresolved' as const, reason: '原文定位与当前文稿不一致，请查看原稿。' };
  return (
    row.assessment ?? {
      kind: 'unresolved' as const,
      reason: '尚无足够依据判断；未匹配不代表遗漏。',
    }
  );
}
export function sourceReviewNeedsAttention(row: SourceReviewRow, sources: ManuscriptSource[]) {
  const { kind } = sourceReviewAssessment(row, sources);
  return kind === 'possible_omission' || kind === 'possible_change';
}
const assessmentLabels = {
  possible_omission: '可能遗漏，请核对',
  possible_change: '可能改错，请对照',
  unresolved: '暂不能判断',
  instruction: '格式 / 整理说明',
  covered: '文字已对应',
};
const originLabels = {
  existing: '原有内容已保留',
  added: '新增补充，待核对合理性',
  modified: '原有内容有改动',
  unknown: '来源基线未知',
};
const origins = ['modified', 'added', 'unknown', 'existing'] as const;
const sections: Record<string, string> = {
  work: '作品介绍',
  world: '世界设定',
  protagonist: '主角',
  actors: '人物',
  relationships: '人物关系',
  history: '已发生事实',
  phone: '开场手机内容',
  places: '地点',
  routes: '路线',
  timeline: '剧情阶段',
  candidates: '未来剧情',
};
function Target({ target }: { target: SourceReviewTarget }) {
  const section = Object.hasOwn(sections, target.section)
    ? sections[target.section]
    : target.section;
  return (
    <div className={s.target}>
      <p className={s.position}>
        {section} · {target.label}
      </p>
      <p className={s.position}>{originLabels[target.origin ?? 'unknown']}</p>
      {target.origin === 'modified' && target.previousValue !== undefined && (
        <div className={s.previous}>
          <p className={s.position}>整理前的内容</p>
          <p className={s.fullText}>{target.previousValue}</p>
          <p className={s.position}>本次提案</p>
        </div>
      )}
      <p className={s.fullText}>{target.value}</p>
    </div>
  );
}
function Row({ row, sources }: { row: SourceReviewRow; sources: ManuscriptSource[] }) {
  const located = locateSourceReviewRow(sources, row);
  const assessment = sourceReviewAssessment(row, sources);
  const status = assessmentLabels[assessment.kind];
  return (
    <article className={s.row}>
      <h5>{located ? `第 ${located.line} 行` : '未能定位到当前原文'}</h5>
      <p className={s.status}>{status}</p>
      <p className={s.help}>{assessment.reason}</p>
      {located ? (
        <>
          <blockquote className={s.quote}>{located.quote}</blockquote>
          <details className={s.context}>
            <summary>定位原文，展开上下文</summary>
            <p className={s.location}>
              文稿 {row.fileIndex + 1} · {located.filename} · 第 {located.line} 行
            </p>
            <p className={s.help}>仅显示原句及邻近片段；全文可在上方原稿区查看。</p>
            <pre>
              {located.beforeTruncated && '…'}
              {located.before}
              <mark>{located.quote}</mark>
              {located.after}
              {located.afterTruncated && '…'}
            </pre>
          </details>
        </>
      ) : (
        <p className={s.notice}>
          这条记录与当前文稿的位置或文字不一致，暂不依据它判断。请查看上方原稿全文。
        </p>
      )}
      {!!row.notices.length && (
        <ul className={s.notices}>
          {row.notices.map((notice, index) => (
            <li key={index}>{notice}</li>
          ))}
        </ul>
      )}
      <div className={s.matches}>
        {row.matches.slice(0, 2).map((match, index) => (
          <section
            className={s.match}
            key={match.target.id + ':' + index}
            aria-label={`对照字段 ${index + 1}`}
          >
            <h6>
              {match.kind === 'literal' ? '含相同文字的实际字段' : '可能对应的实际字段（待核对）'}
            </h6>
            <Target target={match.target} />
            {(match.missingNumbers.length > 0 || match.addedNumbers.length > 0) && (
              <div className={s.numberNotice}>
                <strong>数字文字线索（不单独判定改错）</strong>
                {!!match.missingNumbers.length && (
                  <p>原句中的这些数字未在该字段出现：{match.missingNumbers.join('、')}</p>
                )}
                {!!match.addedNumbers.length && (
                  <p>该字段另含这些数字：{match.addedNumbers.join('、')}</p>
                )}
                <p>这只是文字差异，不能据此确定含义改变或哪一处正确。</p>
              </div>
            )}
          </section>
        ))}
        {!row.matches.length && (
          <p className={s.notice}>
            未找到可展示的对照字段。未匹配不代表遗漏，可能换了写法或暂未支持比对；请结合实际内容检查。
          </p>
        )}
        {row.matches.length > 2 && (
          <p className={s.notice}>此处仅展示前两个候选，请结合下方完整实际内容核对。</p>
        )}
      </div>
    </article>
  );
}

export function PublisherSourceReview({
  sources,
  content,
  baselineContent,
}: {
  sources: ManuscriptSource[];
  content: Record<string, unknown>;
  baselineContent?: Record<string, unknown>;
}) {
  // Comparing content values also invalidates the memo when a caller reuses an object reference.
  const inputKey = JSON.stringify([sources, content, baselineContent]);
  const result = useMemo(() => {
    try {
      return { report: buildPublicationSourceReview(sources, content, baselineContent) };
    } catch {
      return { report: null };
    }
  }, [inputKey, sources, content, baselineContent]);
  const [selection, setSelection] = useState<{ key: string; mode: ReviewMode; limit: number }>({
    key: inputKey,
    mode: 'needs',
    limit: 20,
  });
  const mode = selection.key === inputKey ? selection.mode : 'needs';
  const limit = selection.key === inputKey ? selection.limit : 20;
  const viewKey = inputKey + ':' + mode;
  const [extra, setExtra] = useState({ key: viewKey, open: false, limit: 20 });
  const extraOpen = extra.key === viewKey && extra.open;
  const extraLimit = extra.key === viewKey ? extra.limit : 20;
  const report = result.report;
  if (!report)
    return (
      <section className={s.review} aria-label="原文与实际字段对照">
        <h3>原文与实际字段对照</h3>
        <p role="status">
          本次未能计算文字对照，未显示旧结果。原稿与最终提案仍可查看，请人工核对后继续。
        </p>
      </section>
    );
  const needs = report.rows.filter((row) => sourceReviewNeedsAttention(row, sources));
  const unresolved = report.rows.filter(
    (row) => sourceReviewAssessment(row, sources).kind === 'unresolved',
  );
  const covered = report.rows.filter(
    (row) => sourceReviewAssessment(row, sources).kind === 'covered',
  );
  const priority = (row: SourceReviewRow) => {
    const kind = sourceReviewAssessment(row, sources).kind;
    return kind === 'possible_change'
      ? 0
      : kind === 'possible_omission'
        ? 1
        : kind === 'covered'
          ? 3
          : 2;
  };
  const rows = [
    ...(mode === 'needs'
      ? needs
      : mode === 'unresolved'
        ? unresolved
        : mode === 'covered'
          ? covered
          : report.rows),
  ].sort((a, b) => priority(a) - priority(b));
  const filters: { mode: ReviewMode; label: string; count: number }[] = [
    { mode: 'needs', label: '可能遗漏 / 改错', count: needs.length },
    { mode: 'unresolved', label: '暂不能判断', count: unresolved.length },
    { mode: 'covered', label: '文字已对应', count: covered.length },
    { mode: 'all', label: '全部片段', count: report.rows.length },
  ];
  const visibleRows = rows.slice(0, limit);
  const fileIndexes = [...new Set(visibleRows.map((row) => row.fileIndex))];
  return (
    <section className={s.review} aria-label="原文与实际字段对照">
      <h3>原文与实际字段对照</h3>
      <p className={s.help}>
        这里只比较原文片段与最终提案的文字线索，不能判断语义是否全面正确，也不能保证无遗漏。找到相同文字不代表已核实；请核对年龄、关系和约定等重要细节。
      </p>
      {!!report.warnings.length && (
        <aside className={s.warnings} aria-label="比对限制与提示">
          <h4>比对限制与提示</h4>
          <ul>
            {report.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </aside>
      )}
      <div role="group" aria-label="筛选原文对照" className={s.filters}>
        {filters.map((filter) => (
          <button
            key={filter.mode}
            type="button"
            aria-pressed={mode === filter.mode}
            onClick={() => setSelection({ key: inputKey, mode: filter.mode, limit: 20 })}
          >
            {filter.label}（{filter.count}）
          </button>
        ))}
      </div>
      <p className={s.help}>
        优先展示有具体依据的可能遗漏或改错。暂不能判断与文字已对应可切换查看；未匹配不算遗漏，文字对应也不等于语义已核实。数量仅指本次拆分出的片段，不是完整来源覆盖率。此处不自动修改草稿，也不会替你确认。
        格式 / 整理说明{' '}
        {
          report.rows.filter((row) => sourceReviewAssessment(row, sources).kind === 'instruction')
            .length
        }{' '}
        条，可在“全部片段”查看。
      </p>
      <div key={viewKey}>
        {!report.rows.length ? (
          <p role="status">本次没有形成可对照的原文片段，请查看原稿与限制提示。</p>
        ) : !rows.length ? (
          <p role="status">
            当前分类没有片段；这不代表原稿全部正确带入。请查看“暂不能判断”或“全部片段”。
          </p>
        ) : (
          fileIndexes.map((fileIndex) => (
            <section key={fileIndex} className={s.file} aria-label={`文稿 ${fileIndex + 1}`}>
              <h4>
                {sources[fileIndex]
                  ? `文稿 ${fileIndex + 1} · ${sources[fileIndex]!.filename}`
                  : '无法定位的文稿'}
              </h4>
              {visibleRows
                .filter((row) => row.fileIndex === fileIndex)
                .map((row, index) => (
                  <Row key={row.id + ':' + index} row={row} sources={sources} />
                ))}
            </section>
          ))
        )}
        {rows.length > visibleRows.length && (
          <button
            type="button"
            className={s.more}
            onClick={() =>
              setSelection({ key: inputKey, mode, limit: Math.min(limit + 20, rows.length) })
            }
          >
            显示更多片段（还有 {rows.length - visibleRows.length} 条）
          </button>
        )}
        {!!report.unlinkedTargets.length && (
          <details
            className={s.unlinked}
            open={extraOpen}
            onToggle={(event) =>
              setExtra({ key: viewKey, open: event.currentTarget.open, limit: extraLimit })
            }
          >
            <summary>实际内容中未找到原文线索（{report.unlinkedTargets.length} 项）</summary>
            <p className={s.help}>
              按整理前的草稿区分原有内容与本次补充。新增不代表错误，也不代表已经合理；请对照原稿和创作意图核对。缺少基线时不猜测来源。
            </p>
            {extraOpen && (
              <>
                {origins.map((origin) => {
                  const group = report.unlinkedTargets.filter(
                    (target) => (target.origin ?? 'unknown') === origin,
                  );
                  if (!group.length) return null;
                  const visible = group.slice(0, extraLimit);
                  return (
                    <section
                      key={origin}
                      aria-label={originLabels[origin]}
                      className={s.originGroup}
                    >
                      <h4>
                        {originLabels[origin]}（{group.length} 项）
                      </h4>
                      {origin === 'existing' && (
                        <p className={s.help}>这些文字与整理前一致，不算本次新增。</p>
                      )}
                      {visible.map((target, index) => (
                        <Target key={target.id + ':' + index} target={target} />
                      ))}
                    </section>
                  );
                })}
                {origins.some(
                  (origin) =>
                    report.unlinkedTargets.filter(
                      (target) => (target.origin ?? 'unknown') === origin,
                    ).length > extraLimit,
                ) && (
                  <button
                    type="button"
                    className={s.more}
                    onClick={() =>
                      setExtra({
                        key: viewKey,
                        open: true,
                        limit: Math.min(extraLimit + 20, report.unlinkedTargets.length),
                      })
                    }
                  >
                    显示更多实际字段（还有{' '}
                    {origins.reduce(
                      (count, origin) =>
                        count +
                        Math.max(
                          0,
                          report.unlinkedTargets.filter(
                            (target) => (target.origin ?? 'unknown') === origin,
                          ).length - extraLimit,
                        ),
                      0,
                    )}{' '}
                    项）
                  </button>
                )}
              </>
            )}
          </details>
        )}
      </div>
    </section>
  );
}
