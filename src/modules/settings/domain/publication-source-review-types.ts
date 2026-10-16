/** Author-only, recomputed against supplied source text and final draft. Never a runtime fact. */
export type ManuscriptSource = { filename: string; content: string };
export type SourceReviewTarget = {
  id: string;
  section: string;
  label: string;
  value: string;
  /** Compared only with the supplied pre-import draft, never inferred from model notes. */
  origin?: 'existing' | 'added' | 'modified' | 'unknown';
  previousValue?: string;
};
export type SourceReviewMatch = {
  target: SourceReviewTarget;
  kind: 'literal' | 'candidate';
  missingNumbers: string[];
  addedNumbers: string[];
};
export type SourceReviewRow = {
  id: string;
  fileIndex: number;
  filename: string;
  /** UTF-16 offsets into exactly sources[fileIndex].content; end exclusive. */
  start: number;
  end: number;
  line: number;
  quote: string;
  status: 'literal_match' | 'possible_rewrite' | 'unmapped';
  matches: SourceReviewMatch[];
  notices: string[];
  /** Evidence triage, not an automatic semantic verdict or permission to publish. */
  assessment?: {
    kind: 'covered' | 'possible_omission' | 'possible_change' | 'unresolved' | 'instruction';
    reason: string;
  };
};
export type SourceReview = {
  rows: SourceReviewRow[];
  /** No textual link found; may be existing authored content or a reasonable supplement. */
  unlinkedTargets: SourceReviewTarget[];
  warnings: string[];
};
