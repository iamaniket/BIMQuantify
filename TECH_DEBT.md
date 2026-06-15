# BIMQuantify — Technical-Debt Audit (maintainability)

_Read-only audit, 2026-06-15. This is the **maintainability** companion to `AUDIT_FINDINGS.md`
(which covers security / race-conditions / correctness bugs). Nothing here re-reports those bugs._

Method: a multi-agent fan-out surfaced candidates per subsystem; **every item below was then
verified by hand** against the cited `file:line`. Claims that did not survive verification were
dropped — see _"Checked and NOT debt"_ at the bottom so you can trust what remains.

Tags: **[API]** Python/FastAPI · **[Portal]** Next.js · **[Processor]** BullMQ worker ·
**[DevOps]** infra/build · **[Docs]** documentation.
Effort: **S** <1h · **M** hours · **L** days.

---

## TL;DR — fix these first (best impact ÷ effort)

| # | Item | Tag | Sev | Effort |
|---|------|-----|-----|--------|
| 1 | Auth + audit boilerplate copy-pasted across **38 endpoints** → one `Depends` factory | API | High | M |
| 2 | **No Sentry on the processor** — the one unattended service fails silently | Processor | High | S–M |
| 3 | **No en/nl key-parity test** for the 2 810-key portal catalogs | Portal | High | S |
| 4 | **Zero App Router error boundaries** (32 segments) → also defeats Sentry capture | Portal | High | M |
| 5 | 12 debug `console.*` shipped in `BlogPostCreateDialog.tsx` | Portal | Med | S |
| 6 | Stale eslint + CLAUDE.md exemption paths for moved art files | Portal/Docs | Low | S |

Items 3 and 6 together are well under an hour and close real gaps. Item 1 is the single
highest-leverage refactor (it also resolves #7 below).

---

## HIGH

### 1. [API] Authorization + audit boilerplate is copy-pasted across 38 endpoints
`apps/api/src/bimstitch_api/routers/attachments.py:139-152` (representative), repeated in
`borgingsplan.py`, `bcf.py`, `certificates.py`, `finding.py`, `risks.py`, `capture_links.py`, …

The identical block — only `Resource.X` / `Action.Y` differ — appears at **38 call sites**
(`git grep -c log_permission_denied` over `routers/*.py` = 38):

```python
project = await _load_project_or_404(session, project_id)
membership = await _require_membership(session, project.id, user.id)
try:
    require_permission(membership.role, Resource.attachment, Action.create)
except HTTPException:
    await audit.log_permission_denied(role=..., resource=..., action=..., actor_user_id=user.id, request=request)
    raise
_require_project_writable(project)
```

Authorization is the highest-risk code in a schema-per-tenant app. 38 hand-copies mean any
change to the authz/audit contract must land 38 times, and a single missed copy is a silent
authz or audit-logging gap. **Fix:** collapse to one parametrized FastAPI dependency, e.g.
`project = Depends(require_resource(Resource.attachment, Action.create))`, returning the loaded
project + membership. One tested call site; handlers shrink to a `Depends`. _(This is the same
root cause as #7 — do them together.)_

### 2. [Processor] The one unattended service has no error tracking
`apps/processor/src/` — `git grep -li 'sentry|captureException'` returns **0**.

Both other services wire Sentry (`apps/portal/sentry.{client,edge,server}.config.ts`,
`apps/api/src/bimstitch_api/observability.py`), but the BullMQ worker that runs IFC extraction,
PDF metadata, and Puppeteer report jobs reports nothing — errors land only in pino stdout. A
worker OOM/crash between callbacks is invisible to whatever monitors the other two services.
Telling detail: `apps/api/.../jobs/reconcile.py` (the stuck-job sweeper) exists precisely to
paper over silent worker death — the failure mode is known but unmonitored. **Fix:** add
`@sentry/node`, report on job `failed`, `uncaughtException`, and `unhandledRejection`.

### 3. [Portal] No en/nl key-parity test for the 2 810-key catalogs
`apps/portal/messages/en.json` + `nl.json` — both **2 810 leaf keys, 0 drift today** (clean by
manual discipline only). The API side enforces its (48-key) catalog in CI via
`apps/api/tests/test_i18n_catalog.py`; the portal — by far the larger surface — has **no
equivalent** (only `tests/e2e/admin-blog.spec.ts` references the JSON, and it's not a parity
check). The bilingual rule is a documented hard rule; one dropped key ships a half-translated
screen. **Fix:** a ~20-line `vitest` that flattens both files and fails on any leaf-key **or**
`{placeholder}` asymmetry. Cheapest durable guard in this report.

### 4. [Portal] Zero App Router error boundaries across 32 route segments
`apps/portal/src/app/**` — **0** `error.tsx` / `global-error.tsx` against **32** `page.tsx`
segments; the only React error boundary in the whole portal is feature-local
(`features/viewer/bcf/BcfPanel.tsx`). Two costs: (a) any uncaught render error shows Next's
default fallback with no recovery UI; (b) `@sentry/nextjs` is wired, but its App Router
render-error capture **relies on `global-error.tsx`** — without it the client render crashes
users hit most never reach the Sentry you're paying for. **Fix:** add a `global-error.tsx`
(restores Sentry capture) plus segment-level `error.tsx` for the dashboard and viewer groups.

---

## MEDIUM

### 5. [Portal] 12 debug `console.*` statements shipped in one component
`apps/portal/src/features/admin/blog/BlogPostCreateDialog.tsx` — **12** `console.log/warn`
lines, all `'[blog-cover]'`-tagged, dumping form state; not `NODE_ENV`-gated so they ship in
the production bundle. These are **13 of the 13** non-test `console.log/warn` in portal `.tsx`
— i.e. essentially all of the portal's stray logging is concentrated here, a clear
rushed/under-tested-file smell. **Fix:** delete them (or gate behind a debug flag).

### 6. [API] Pagination params hand-copied across 25 endpoints with inconsistent caps
`apps/api/src/bimstitch_api/routers/*.py` — `limit: int = Query(...)` appears **25×** with
**inconsistent `le` caps**: `le=50` ×1, `le=100` ×2, `le=200` ×11, `le=500` ×10, `le=1000` ×1.
No shared `Pagination` dependency. Beyond duplication, the divergent caps are a latent
abuse-surface and a "which cap applies here?" cognitive tax. **Fix:** a shared
`Pagination = Depends(...)` with one default/cap policy; opt specific routers out explicitly.

### 7. [API] Tenant authz primitives are private functions in a 1 224-line leaf router, imported by 20 routers
`apps/api/src/bimstitch_api/routers/projects.py:176-332` defines `_load_project_or_404`,
`_get_membership`, `_require_membership`, `_is_org_admin`, `_require_project_read_access`,
`_require_project_write_access`, `_require_project_writable` — then **20** sibling routers do
`from bimstitch_api.routers.projects import (_…)` (`git grep -l` = 20). A leaf route file is the
de-facto security library, the `_`-prefix lies about a contract that's reused everywhere, and
refactoring `projects.py` fans out invisibly to every resource (plus import-cycle risk).
**Fix:** extract to a dedicated public `bimstitch_api/access.py` (or `routers/_deps.py`) with
non-underscore names + `Depends` wrappers — the natural home for the #1 factory and for
unit-testing the access matrix in one place.

### 8. [DevOps] Patch graveyard with no provenance
`patches/@phosphor-icons__react.patch` **plus** `.patches/phosphor-fix` **plus**
`.patches/phosphor-rsc-fix` — three hand-maintained patch artifacts against `@phosphor-icons/react`
(pinned in `packages/ui` as a **caret** `^2.1.10`, so the patch can silently fail to apply on the
next lockfile refresh), and a hard `pnpm.overrides` pin of `@opentelemetry/instrumentation` to
exactly `0.214.0` (root `package.json`). **None carry an inline comment or issue link** explaining
why they exist or when they can be dropped — classic "nobody dares remove it" debt. **Fix:**
document each (reason + removal condition), exact-pin the patched dep so a mismatch fails loudly,
and track an upgrade-past-it task.

### 9. [API] `type: ignore` cluster at the Arbiter/MCP compliance seam
`apps/api/src/bimstitch_api/compliance/__init__.py:32-108` holds **6 of the API's 15**
`type: ignore` (`no-any-return`), because the Arbiter MCP response is handled as raw JSON. This
untyped boundary feeds the **core compliance-check feature**, so shape drift surfaces at runtime
instead of at the seam. **Fix:** define a Pydantic/`TypedDict` model for the MCP payload and parse
into it; the suppressions disappear and drift becomes a typed error.

### 10. [Portal] `no-literal-string` lint left at `warn` with ~80 acknowledged hardcodes
`apps/portal/eslint.config.mjs:51` — the rule is `'warn'`, and the inline comment openly admits
~80 unmigrated JSX-text hardcodes and a deliberate "keep visible, don't block ship" decision. So
the bilingual hard rule is **advisory** in the UI layer (where the strings overwhelmingly live)
until the backlog is burned down. This is _acknowledged_ debt, listed so it stays tracked.
**Fix:** migrate the ~80 through `useTranslations()` / `@bimstitch/i18n`, then graduate the rule
to `'error'` so new violations block CI.

---

## LOW

### 11. [Portal/Docs] Stale i18n-exemption paths for moved skeuomorphic-art files
`apps/portal/eslint.config.mjs:66-67` exempts
`src/components/shared/viewer/settings/{VisualKeyboard,MouseDiagram}.tsx` from `no-literal-string`,
and `CLAUDE.md:259` cites the same path — but the files actually live at
`src/components/shared/viewer/**shared/**settings/{VisualKeyboard,MouseDiagram}.tsx` (extra
`shared/` segment). The exemption silently no longer matches, so the intentionally-exempt art now
emits warnings. **Fix:** add the `shared/` segment in both the eslint glob and CLAUDE.md.

### 12. [DevOps] Portal dev/build bundler split (Turbopack vs Webpack)
`apps/portal/package.json:7,9` — `dev` runs `next dev --turbopack`, `build` runs
`next build --webpack`. Developers iterate on a different bundler than production ships, so
divergences (CSS ordering, env inlining, module resolution) only appear at build/prod time.
**Fix:** standardize on one bundler, or add a code comment + CLAUDE.md note explaining why both
are pinned.

### 13. [Docs] CLAUDE.md drift
- `CLAUDE.md:241` says **"Next.js 15"**; portal and web both run `next ^16.2.9`.
- The stale art-file path (#11).
- Per `AUDIT_FINDINGS.md`, the claim _"the register limiter now guards the admin invite path"_ is
  stale (no limiter is wired to `invite_member`).
- Prose hard-codes test counts ("currently 253 tests"); the API suite is ~80 files — drop exact
  counts from prose, they rot.

### 14. [API/Portal/Viewer] God-files (oversized modules)
`packages/viewer/src/plugins/3d/measurement/index.ts` (**1 736**), `routers/borgingsplan.py`
(1 262), `routers/bcf.py` (1 241), `routers/projects.py` (1 224), `routers/reports.py` (978),
`features/projects/detail/BorgingsplanSection.tsx` (1 087), the viewer `page.tsx` (1 023),
`packages/viewer/src/core/Viewer.ts` (1 063). These drag review/merge/onboarding velocity.
**Fix:** opportunistic extraction (split routers by sub-resource; lift the measurement plugin's
geometry/state/render concerns into modules) — large, do as you touch them, not as a big-bang.

### 15. [API] One genuinely untested router: `ws_notifications`
The API suite is strong (~80 test files; nearly every router has a `test_*.py`). The one real
gap is `routers/ws_notifications.py` — `git grep` finds **0** websocket tests. Websockets are
awkward to test, so this is understandable, but it's the lone uncovered live router. (`admin_blog`,
`element_inspections`, `organization_settings`, `organization_image` are all covered — the earlier
"5 untested routers" suspicion did **not** hold up.)

---

## Checked and NOT debt (so you can trust the rest)

- **TypeScript type-safety is excellent.** `any` appears **twice** in all of portal + packages +
  processor, and `eslint.config.mjs` sets `no-explicit-any`, `no-unsafe-*`, `no-non-null-assertion`,
  and `ban-ts-comment` (ts-ignore/ts-expect-error) all to **`error`**. An automated claim of
  "~36 `any`-casts in the viewer core" was **false** (actual: 0). Type debt exists **only** on the
  Python side (#9), and modestly.
- **API test coverage is a strength**, not a gap (see #15). The portal is the side that's thin
  (~23 unit + ~7 e2e files), which is why #3/#4 target it.
- **The bilingual catalogs are in perfect parity today** (2 810 == 2 810, 0 drift). The debt is the
  missing *guard* (#3), not actual drift.
- **TODO/FIXME markers are diffuse** (≤2 per file) — no clustered hidden-work backlog.
- The bug-class items in `AUDIT_FINDINGS.md` (seat-limit race, secret defaults, polling loops, …)
  are deliberately excluded here; that document still owns them.

---

## Suggested sequencing

1. **One sitting (<1h total):** #3 (parity test), #11 (stale paths), #5 (strip console logs), #13
   (doc fixes).
2. **Next:** #2 (processor Sentry) and #4 (global-error.tsx) — both close real observability holes
   cheaply.
3. **Then the leverage refactor:** #1 + #7 together — extract `access.py`, build the
   `require_resource(...)` dependency, migrate the 38 sites; fold #6 (shared `Pagination`) into the
   same pass since it's the same "shared router dependency" shape.
4. **Background/opportunistic:** #8 (patch hygiene), #9 (typed MCP model), #10 (burn down hardcodes
   → flip lint to error), #12 (bundler), #14 (god-file splits as you touch them).
