import { gettingStarted } from './getting-started';
import { HELP_CATEGORY_ORDER, type HelpArticle, type HelpCategory } from './types';
import { usingTheViewer } from './using-the-viewer';

/**
 * The help-article registry. Every article is bilingual (`en` + `nl` required).
 *
 * Intended category taxonomy (add articles under the matching `category`):
 *   gettingStarted  — onboarding, first project
 *   modelsUploads   — IFC/PDF upload, extraction, statuses
 *   viewer          — navigation, measure, section, split, floor plans
 *   findings        — creating, assigning, resolving, verifying snags
 *   compliance      — checks, frameworks (Bbl/Wkb), PDF reports
 *   deadlines       — deadline reminders, org calendar
 *   account         — profile, members, templates, certificates
 *
 * To add an article: create `content/<topic>.ts` exporting a `HelpArticle`, then append it
 * here. Categories with no articles are hidden from the rail/hub automatically.
 */
export const HELP_ARTICLES: HelpArticle[] = [
  gettingStarted,
  usingTheViewer,
];

export { HELP_CATEGORY_ORDER };
export type { HelpArticle, HelpCategory };
