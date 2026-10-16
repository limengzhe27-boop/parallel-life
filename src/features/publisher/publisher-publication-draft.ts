import { PublishedWorldContentSchema } from '../../contracts/published-world-content.ts';
import type { PublisherWorkbenchDraft } from '../../contracts/publisher-workbench.ts';
import { ensurePublishableDefaults } from '../../modules/settings/domain/publication-defaults.ts';

/** Candidate technical defaults are saved explicitly, never used as a parallel check-only draft.
 * Leave incomplete or invalid authored drafts untouched for the existing issue/prepare flow.
 */
export function publicationDraft(draft: PublisherWorkbenchDraft): PublisherWorkbenchDraft {
  if (PublishedWorldContentSchema.safeParse(draft.content).success) return draft;
  const candidate = ensurePublishableDefaults(draft.content, draft.title);
  return PublishedWorldContentSchema.safeParse(candidate).success
    ? { ...draft, content: candidate }
    : draft;
}

/** Missing/blank input may use the existing explicit trial preparation. An authored
 * invalid value needs correction, never an automatic model rewrite to make it pass.
 */
export function publicationAuthoredIssues(content: Record<string, unknown>) {
  const parsed = PublishedWorldContentSchema.safeParse(content);
  if (parsed.success) return [];
  return parsed.error.issues
    .filter((issue) => {
      let value: unknown = content;
      for (const key of issue.path) {
        if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return false;
        value = (value as Record<PropertyKey, unknown>)[key];
      }
      return value !== undefined && !(typeof value === 'string' && !value.trim());
    })
    .map((issue) => ({
      path: issue.path.map((key) => (typeof key === 'number' ? key : String(key))),
      code: issue.code,
    }));
}
