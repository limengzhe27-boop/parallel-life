'use client';

import { PublisherScriptLibraryEditor } from './publisher-script-library-editor.tsx';

export type PublisherPlotEditorProps = {
  content: Record<string, unknown>;
  disabled: boolean;
  onChange: (next: Record<string, unknown>) => void;
};

/** Candidates are edited once, in the event library. Other authored world data stays in the draft. */
export function PublisherPlotEditor({ content, disabled, onChange }: PublisherPlotEditorProps) {
  return <PublisherScriptLibraryEditor content={content} disabled={disabled} onChange={onChange} />;
}
