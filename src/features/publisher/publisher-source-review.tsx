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
export function sourceReviewNeedsAttention(row: SourceReviewRow, sources: ManuscriptSource[]) {
  return (
    row.status !== 'literal_match' ||
    row.notices.length > 0 ||
    row.matches.some((match) => match.missingNumbers.length > 0 || match.addedNumbers.length > 0) ||
    !locateSourceReviewRow(sources, row)
  );
}
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
      <p className={s.fullText}>{target.value}</p>
    </div>
  );
}
function Row({ row, sources }: { row: SourceReviewRow; sources: ManuscriptSource[] }) {
  const located = locateSourceReviewRow(sources, row);
  const status = !located
    ? '原文定位需核对'
    : row.status === 'literal_match'
      ? '找到相同文字'
      : row.status === 'possible_rewrite'
        ? '疑似改写，请对照'
        : '未找到文字对应（可能遗漏或换写）';
  return (
    <article className={s.row}>
      <h5>{located ? `第 ${located.line} 行` : '未能定位到当前原文'}</h5>
      <p className={s.status}>{status}</p>
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
                <strong>数字差异，请核对</strong>
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
            未找到可展示的对照字段。原句可能遗漏，也可能换了写法或暂未支持比对；请结合实际内容检查。
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
}: {
  sources: ManuscriptSource[];
  content: Record<string, unknown>;
}) {
  // Comparing content values also invalidates the memo when a caller reuses an object reference.
  const inputKey = JSON.stringify([sources, content]);
  const result = useMemo(() => {
    try {
      return { report: buildPublicationSourceReview(sources, content) };
    } catch {
      return { report: null };
    }
  }, [inputKey, sources, content]);
  const [selection, setSelection] = useState<{ key: string; mode: 'needs' | 'all'; limit: number }>(
    {
      key: inputKey,
      mode: 'needs',
      limit: 20,
    },
  );
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
  const rows = mode === 'needs' ? needs : report.rows;
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
        <button
          type="button"
          aria-pressed={mode === 'needs'}
          onClick={() => setSelection({ key: inputKey, mode: 'needs', limit: 20 })}
        >
          需核对（{needs.length}）
        </button>
        <button
          type="button"
          aria-pressed={mode === 'all'}
          onClick={() => setSelection({ key: inputKey, mode: 'all', limit: 20 })}
        >
          全部片段（{report.rows.length}）
        </button>
      </div>
      <p className={s.help}>
        数量仅指本次拆分出的片段，不是完整来源覆盖率。此处不自动修改草稿，也不会替你确认。
      </p>
      <div key={viewKey}>
        {!report.rows.length ? (
          <p role="status">本次没有形成可对照的原文片段，请查看原稿与限制提示。</p>
        ) : !rows.length ? (
          <p role="status">
            本次片段未显示需重点核对的项；这不代表原稿全部正确带入。可切换“全部片段”逐条查看。
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
              这些内容可能来自已有草稿或合理补充，也可能是本次比对没有识别，不能直接判为错误。请对照原稿和编剧意图核对。
            </p>
            {extraOpen && (
              <>
                {report.unlinkedTargets.slice(0, extraLimit).map((target, index) => (
                  <Target key={target.id + ':' + index} target={target} />
                ))}
                {report.unlinkedTargets.length > extraLimit && (
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
                    显示更多实际字段（还有 {report.unlinkedTargets.length - extraLimit} 项）
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
