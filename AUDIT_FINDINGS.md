> **⚠️ PARTIALLY SUPERSEDED (2026-06-28).** Several criticals below are now FIXED in code
> (secret defaults, CORS wildcard, seat-limit race, capture-link race). The current consolidated
> pre-launch audit is **[`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md)** — read it
> first; it carries forward the still-open items here with current line numbers and completes the
> Processor review this doc left pending.

# BIMQuantify — Architecture / Bug / Race-Condition Audit

_Read-only audit. No code was modified. Findings are ranked by severity and tagged by
subsystem: **[API]** (Python/FastAPI), **[DevOps]** (infra/config), **[Portal]**
(Next.js frontend), **[Processor]** (Node/BullMQ worker)._

Coverage: API, DevOps/infra, and Portal were fully audited. The Processor audit was
interrupted by a session limit and is being completed separately (see _Processor_ section).

---

## TL;DR — fix these first

1. **[API] Seat-limit race** lets concurrent invites exceed the paid seat cap (billing
   leak). — _CRITICAL_
2. **[DevOps] Secrets fall through to insecure defaults** if env vars are unset: the
   inter-service shared secret and the S3 credentials both default to well-known dev
   values instead of failing closed. — _CRITICAL_
3. **[Portal] Cross-tab tenant desync**: switching org in one tab leaves other tabs
   operating on the *old* tenant's JWT → silent wrong-tenant reads/writes. — _CRITICAL_
   — ✅ **RESOLVED** (see §4).
4. **[API] Public capture-link `use_count` race** lets a `max_uses=1` link be consumed
   many times (unauthenticated endpoint). — _HIGH_
5. **[DevOps] Rate-limit bypass** via client-supplied `X-Forwarded-For`, plus no rate
   limit on invite / report-generation / file-initiate. — _HIGH_ — _RESOLVED (XFF identifier
   + per-user/per-IP limiters now cover invite/resend, all presign-initiate endpoints, and
   the public capture upload; see #6/#7)._
6. **[DevOps] Tenant-schema migration drift** has no startup guardrail — a deploy that
   forgets to migrate existing org schemas 500s every existing tenant. — _HIGH_

---

## CRITICAL

### 1. [API] Seat-limit TOCTOU — concurrent invites exceed the paid cap

> **✅ RESOLVED (commit `df621d31`, 2026-06-26).** `assert_seat_available`
> (`admin/seats.py:41-70`) now takes `select(Organization.id).with_for_update()`
> before counting, holding the row lock until the surrounding transaction
> commits — serializing count-then-insert per org. Both seat-consuming call
> sites are covered: `invite_member` (`routers/organization_members.py:281`) and
> `update_member_guest` (`:551`). Regression test:
> `tests/test_admin_seats.py::test_concurrent_invites_cannot_exceed_seat_cap`
> races two invites and asserts exactly one 201 + one 409, with the final count
> equal to the cap. Original (pre-fix) finding text retained below for history.

`apps/api/src/bimdossier_api/admin/seats.py:41-54` (`assert_seat_available`), called from
`apps/api/src/bimdossier_api/routers/organization_members.py:198` (`invite_member`) and
`:458` (`update_member_guest`).

`assert_seat_available` does an unlocked `SELECT COUNT(*)` then inserts the new member in a
separate statement. Two invites racing on the last seat both read `used == limit-1`, both
pass, both insert → `seat_limit` exceeded. This is a billing/monetization boundary, so
over-provisioning is a direct revenue leak. No DB-level constraint backs the invariant;
the only guard is the racy read.

**Fix:** take `pg_advisory_xact_lock(org_id)` or `SELECT ... FOR UPDATE` the `Organization`
row before counting, inside the same transaction as the insert — the same pattern the
last-admin invariant already uses (`membership_rules.py`, `with_for_update`).

### 2. [DevOps] Inter-service shared secret falls through to a public default
`apps/api/src/bimdossier_api/config.py:98-100` (`processor_shared_secret` default
`"dev-shared-secret-change-me"`), `apps/processor/src/config.ts:16` (same default),
`docker-compose.yml:77` (`${PROCESSOR_SHARED_SECRET:-dev-shared-secret-change-me}`).

This secret is the *only* thing gating `POST /internal/jobs/callback` (which writes job /
report terminal state) and job dispatch. Because it's defined as a default rather than a
required field, a deploy with the env var unset starts silently with a publicly-known
secret — an attacker who knows the default can forge worker callbacks.

**Fix:** make it a required field (no default), like `jwt_secret` / `database_url` already
are. Fail closed at startup if unset.

### 3. [DevOps] S3 credentials default to the dev MinIO root creds
`apps/api/src/bimdossier_api/config.py:78-79` — `s3_access_key_id` defaults to
`"bimdossier"`, `s3_secret_access_key` to `"bimdossier-secret"`.

A prod deploy that forgets to set S3 creds silently uses the well-known dev MinIO
credentials instead of erroring. Same fall-through-to-prod class as #2.

**Fix:** make both required (no default).

### 4. [Portal] Cross-tab token desync → wrong-tenant data hazard

> **✅ RESOLVED (commit `df621d31`, 2026-06-26).** `AuthProvider.tsx:157-182`
> now registers a `window.addEventListener('storage', …)` listener scoped to the
> `bimdossier.tokens` key (`e.key === null` also covers `localStorage.clear()`).
> On a cross-tab change it re-reads the stored pair, no-ops if the `access_token`
> is unchanged (prevents same-value echo loops), then updates `tokensRef.current`
> + `setTokensState` **directly** (not via `setTokens`, which would write back and
> re-emit) and calls `queryClient.invalidateQueries()` so no previous-org data
> lingers. The effect watching `tokens` re-fetches `/auth/me`; on logout
> (`next === null`) the route guards redirect to `/login`. Regression test:
> `AuthProvider.crosstab.test.tsx` (adopt-new-token-on-switch + asserts cache
> invalidation, clear-on-logout, ignore-unrelated-keys — 3/3 green). Confirmed in
> `docs/PRODUCTION_READINESS.md` §9 ("cross-tab token desync listener added").
> The cited line numbers below are from the pre-fix revision; original text
> retained for history.
>
> **Adjacent items:** _#11_ — the last wrong-tenant window (a refetch reusing the
> *old* org's token; this fix closed the auth-system staleness, #11 was the
> data-layer seam) — is now **✅ RESOLVED** (see §11; the data hooks read the live
> token). _M-fe2_ (PRODUCTION_READINESS.md §Frontend) remains open — stale
> `me`/role renders briefly until `/auth/me` refetches (UI-only; backend still
> authorizes off the JWT).

`apps/portal/src/providers/AuthProvider.tsx:64-75, 84-89, 138-150`.

Tokens persist to `localStorage` but nothing listens for the `storage` event (zero matches
for `addEventListener('storage')` in the portal). The backend is schema-per-tenant keyed
off the JWT `org` claim. When `switchOrganization()` rewrites the `org` claim in one tab,
other open tabs keep the *old* org's JWT in memory and will silently read/write the **wrong
tenant's schema** until a manual reload. Logout in one tab likewise leaves other tabs
firing a dead token.

**Fix:** add a `storage`-event listener that re-hydrates tokens (or forces logout/reload)
when `bimdossier.tokens` changes in another tab.

---

## HIGH

### 5. [API] Public capture-link `use_count` race — `max_uses` over-consumption
`apps/api/src/bimdossier_api/routers/capture_public.py:187` (`link.use_count += 1`), gate at
`:71-77` (`_load_and_validate_link`).

`is_exhausted` is checked against the ORM-loaded `use_count`, then `use_count += 1` is
written back as a Python-level increment (not an atomic SQL `UPDATE`). On these
**unauthenticated** endpoints, N concurrent uploads against a `max_uses=1` link all read
`use_count=0`, all pass `is_valid`, all increment to 1 → the single-use link is consumed
many times, each creating an `Attachment`. The token is the only authz gate, so its cap
must hold under concurrency.

**Fix:** `SELECT ... FOR UPDATE` the `CaptureLink` row, or do a conditional atomic
`UPDATE capture_links SET use_count = use_count + 1 WHERE id = :id AND (max_uses IS NULL OR
use_count < max_uses)` and treat zero-rows-affected as exhausted.

### 6. [DevOps] Rate limiting trusts client-supplied `X-Forwarded-For` — RESOLVED
~~`FastAPILimiter.init(redis)` is called with no custom `identifier`, so the library
default keys the rate limit on the first `X-Forwarded-For` value verbatim. No
`--forwarded-allow-ips` / `--proxy-headers` is set on uvicorn anywhere. Any client can send
a random `X-Forwarded-For` per request to get a fresh bucket, defeating the login /
forgot-password / refresh brute-force limits.~~

**App layer (already landed before this pass):** `FastAPILimiter.init` is wired with a
custom identifier — `main.py` passes `default_rate_limit_identifier`, and
`auth/ratelimit.py::_client_ip` honors `X-Forwarded-For` only from peers in
`TRUSTED_PROXY_IPS`, taking the right-most hop. (The original `main.py:79 "no custom
identifier"` reference was stale.) Covered by `tests/test_rate_limit.py:98-137`.

**Deployment layer (this pass):** uvicorn's proxy-header trust is now explicit, documented,
and guarded so prod can only be set up safely:
- `FORWARDED_ALLOW_IPS` is a first-class config field; `validate_production_config` refuses
  to boot outside dev when it (or `TRUSTED_PROXY_IPS`) is `*` — the setting that would make
  uvicorn trust XFF from any peer. Guard cases in `tests/test_production_config_guard.py`.
- `--proxy-headers` is explicit on the launch commands we control (`apps/api/package.json`,
  E2E `global-setup.ts`); `log_secret_sources` reports the effective `FORWARDED_ALLOW_IPS`.
- `.env.example` + `CLAUDE.md` document the two-layer model (uvicorn `FORWARDED_ALLOW_IPS`
  owns resolution in prod — set the proxy IP/CIDR, never `*` — with `TRUSTED_PROXY_IPS` as
  the in-process fallback) and the canonical production run command.

**Out of scope (separate gap):** no API Dockerfile / production run artifact exists in-repo
(`PRODUCTION_READINESS.md` M-sec4) — the documented command above is the interim contract.

### 7. [DevOps] Rate-limit coverage gaps on expensive / abusable endpoints
Only login, forgot-password, refresh, and access-requests carry a `RateLimiter`. Missing:
- `POST /organizations/{id}/members` (`invite_member`, `routers/organization_members.py:132-144`)
  — sends an email per call (account enumeration / mail-bomb).
- `POST /projects/{id}/reports` (`create_report`, `routers/reports.py:171`) — dispatches a
  Puppeteer/Chromium PDF job; only `MAX_CONCURRENT_JOBS_PER_ORG` caps concurrency, not rate.
- File `initiate` (presigned-PUT minting).

Note: the CLAUDE.md claim that "the register limiter now guards the admin invite path" is
**stale** — `invite_member` has no limiter dependency, and `REGISTER_RATE_LIMITER`
(`auth/routes.py:36-39`) is no longer wired to any route.

**Fix:** add limiters to invite, report-create, and file-initiate.

> **RESOLVED.** `create_report` (`REPORT_GEN_LIMITER`), the project-files `initiate`
> (`UPLOAD_INITIATE_LIMITER`), and the compliance check (`COMPLIANCE_CHECK_LIMITER`) were
> already covered before this pass. This pass adds the remaining coverage:
> - `invite_member` + `resend_invite` → shared per-user `INVITE_LIMITER` (30/hr,
>   `RATE_LIMIT_INVITE_PER_HOUR`) — closes the mail-bomb / enumeration vector.
> - The four other presigned-PUT minting endpoints (attachments, certificates,
>   org-certificates, org-template-assets) now reuse `UPLOAD_INITIATE_LIMITER` (one shared
>   100/hr per-user presign budget).
> - The **public** capture-link `initiate` → per-IP `CAPTURE_INITIATE_LIMITER` (120/hr,
>   `RATE_LIMIT_CAPTURE_INITIATE_PER_HOUR`).
> - The orphaned `REGISTER_RATE_LIMITER` and its `RATE_LIMIT_REGISTER_PER_HOUR` knob were
>   removed; the stale CLAUDE.md line was corrected. New 429-enforcement tests in
>   `tests/test_rate_limit.py`. (429s bypass the i18n envelope, so no error-catalog change.)

### 8. [DevOps] Tenant-schema migration drift has no guardrail
Existing org schemas are upgraded only by manually running
`uv run python -m bimdossier_api.scripts.migrate_all` after deploy. `migrations_check.py:23-29`
deliberately checks **only** the master chain at startup, so there is **zero** signal if
tenant schemas are behind. Deploy code expecting a new tenant column without running
`migrate_all` → every existing tenant 500s while new tenants work.

**Fix:** wire `migrate_all` into the deploy pipeline as a gate, and/or add a per-org
pending-migration health check.

### 9. [API] Processor callback's post-commit work is not crash-isolated
`apps/api/src/bimdossier_api/routers/jobs_internal.py:207-216` and `:283-295`.

The terminal state is committed idempotently (correct — `with_for_update` + terminal-state
guards). But the post-commit work (emit notification, refresh re-anchoring `search_path`)
runs **unguarded** by try/except — unlike every other emitter in the codebase
(`reports.py:300-307`, `notifications/service.py:117`, `reminder_engine.py:208`). A
transient Redis blip raises → endpoint returns 500 even though the DB is already terminal →
worker reads "callback failed" and retries → re-runs the same unguarded path.

**Fix:** wrap the post-commit emit/refresh in try/except-log, matching the other emitters.
_(Whether the worker actually retries on 5xx is part of the pending Processor audit.)_

### 10. [API] `update_finding` promotion sends a hardcoded Dutch-only notification
`apps/api/src/bimdossier_api/routers/finding.py:238-244` — `title="Nieuwe bevinding
toegewezen"`, no locale resolution. Violates the project's hard bilingual rule; an
EN-locale assignee gets a Dutch push. Also broadcast to the org channel rather than scoped
to the assignee despite the "toegewezen" (assigned) wording.

**Fix:** resolve the project jurisdiction's locale (as `reports.py` does), provide nl+en
strings, and decide whether delivery should be assignee-scoped.

### 11. [Portal] `useAuthQuery` / `useAuthMutation` capture a stale access token

> **✅ RESOLVED (2026-06-28).** Both hooks now read the LIVE token via
> `tokenManager.getAccessToken(accessToken)` inside the `queryFn`/`mutationFn`
> instead of using the render-time `accessToken` capture. `getAccessToken`
> returns the registered getter's current value (`AuthProvider`'s
> `tokensRef.current`), so an invalidate-driven refetch right after a cross-tab
> org switch (#4) — or a `mutateAsync` loop after a refresh — fires with the new
> tenant's token, not the previous one. The render-time token is used only as a
> pre-registration fallback (once registered, a `null` result is authoritative
> "logged out" and the fallback is ignored, so a logout never resurrects a stale
> token) and still drives the query `enabled` gate. Regression test:
> `useAuthQuery.test.tsx` (refetch-after-switch uses the live token,
> mutation-after-change uses the live token, `getAccessToken`
> fallback/live/logged-out semantics — 3/3 green). This closes the last
> wrong-tenant window that #4 left open. Original (pre-fix) text retained below.

`apps/portal/src/lib/query/useAuthQuery.ts:37-58, 73-94`.

The hook captures `accessToken` from `useAuth()` at render time rather than reading the live
`tokensRef.current` the rest of the auth system uses. Closures created with the old token —
invoked again before React re-renders (React Query retry, or `mutateAsync` in a loop) —
fire with the stale token → 401 → another refresh. Single-flighted refresh bounds the
storm, but it produces redundant 401→refresh cycles and can race refresh-token rotation
(potential spurious logout).

**Fix:** read the token from `tokensRef.current` inside the `queryFn`/`mutationFn`.

### 12. [Portal] Job/file polling never stops on error — infinite failing-request loop
`apps/portal/src/features/reports/hooks.ts:51-57`, `apps/portal/src/features/models/useModelFiles.ts:23-30`.

`refetchInterval` decides solely on `query.state.data`. If a poll 401s and refresh fails
(or any persistent error), the query goes to error state but `query.state.data` still holds
the last non-terminal snapshot, so `refetchInterval` keeps returning a positive interval
forever — one failing request per tick, indefinitely (global `retry:false`).

**Fix:** return `false` from `refetchInterval` when `query.state.status === 'error'`.

### 13. [Portal] `FindingPhotos` batch upload uses stale `photoIds`, dropping photos
`apps/portal/src/features/projects/detail/FindingPhotos.tsx:69-96`.

`handleFileChange` closes over `photoIds` and, after awaiting all picked uploads, calls
`onChange([...photoIds, ...added])`. A second pick while the first batch is still uploading
captures a `photoIds` that lacks the first batch's not-yet-committed ids → `onChange`
overwrites and the first batch is lost. (WIP file.)

**Fix:** use a functional updater `onChange(prev => [...prev, ...added])` (widen the prop)
or accumulate via a ref.

---

## MEDIUM

### 14. [API] Capture-link double-complete TOCTOU on `Attachment.status`
`apps/api/src/bimdossier_api/routers/capture_public.py:236-249`. Attachment selected without
`with_for_update`; two concurrent `complete` calls both read `pending`, both flip and
double-write audit rows / double-HEAD storage. Lower impact (idempotent end state, unique
`content_sha256`). **Fix:** `FOR UPDATE` or conditional UPDATE guarded on `status='pending'`.

### 15. [API] `invite_to_project` opens a second DB session while the tenant session is open
`apps/api/src/bimdossier_api/routers/projects.py:934, 948-1072`. Endpoint takes
`get_tenant_session` but does all writes on a separate `get_session_maker()` session
committed independently — non-atomic from the client's view (a failure after `ms.commit()`,
e.g. `request_verify` at `:1088`, leaves the invite durably committed but returns 500), and
doubles pool consumption per invite. Not an isolation break (raw INSERT correctly
sets/restores `search_path`). **Fix:** drop the unused tenant-session dependency or document
the deliberate two-session design.

### 16. [API] Invite acceptance doesn't re-check seats

> **✅ RESOLVED (2026-06-28).** Both halves addressed.
> **Accept backstop:** `accept_invitation` (`routers/me_invitations.py`) now calls the new
> `assert_within_seat_limit` (`admin/seats.py`) — gated by `if not member.is_guest`, mirroring
> the invite path's guest exemption. Acceptance is **seat-neutral** (pending and active both
> count in `count_consumed_seats`), so the helper uses a strict `>` (`consumed > limit`), NOT
> `assert_seat_available`'s `>=`: a normally full org (consumed == limit) still accepts, and
> only a genuinely over-provisioned org is rejected with `SEAT_LIMIT_EXCEEDED`. No row lock —
> accept can't itself push the count over, and the downgrade guard already holds the invariant.
> **Downgrade reconciliation (confirmed):** the PATCH path (`admin_organizations.py`) computes
> `used = count_consumed_seats(...)` (which counts pending) and rejects `seat_limit < used` with
> `SEAT_LIMIT_BELOW_USAGE`, so the cap can't be lowered below active + pending — pending invites
> are reconciled, no separate fix needed. **Tests:** `test_invitations.py` (accept at full
> capacity succeeds; over-provisioned accept 409s + stays pending; guest bypasses regular-seat
> overage) and `test_admin_seats.py` (`assert_within_seat_limit` unit cases; pending counts in
> the downgrade guard). Original finding text retained below.
>
> _Note: the login bootstrap auto-accept (`auth/routes.py::_flip_pending_memberships`) also flips
> pending→active but is deliberately NOT gated — blocking it would lock a brand-new user out of
> login entirely (zero active orgs), and that seat was reserved + seat-checked at invite time and
> can't be validly over-provisioned (the downgrade guard counts it). The explicit-accept endpoint
> is the right place for a user-facing 409._

`apps/api/src/bimdossier_api/routers/me_invitations.py:112-162`. By design pending invites
count toward seats, but if `seat_limit` is lowered (downgrade) acceptance has no backstop —
and combined with #1 the count itself can be wrong. **Fix:** re-check seats on accept;
confirm the downgrade path reconciles existing pending invites.

### 17. [API] Compliance check holds the tenant transaction open across a 30s external call

> **✅ RESOLVED (commit `df621d31`, 2026-06-26).** `check_compliance`
> (`routers/compliance.py`) now runs as three short transactions via
> `open_tenant_session` (`tenancy.py:162`): (1) validate + persist the `running`
> Job, then commit and release the pooled connection; (2) call the Arbiter with
> **no** connection held; (3) persist the result/failure + audit in a fresh short
> transaction. The ~30s Arbiter latency no longer pins a `DB_POOL_SIZE`
> connection, so a slow Arbiter can't cascade into pool exhaustion. Regression
> test: `tests/test_compliance_check.py::test_check_releases_db_connection_across_arbiter_call`
> reads the `running` Job from a separate session *during* the stubbed Arbiter
> call — visible under READ COMMITTED only if phase 1 already committed. Original
> (pre-fix) finding text retained below for history.

`apps/api/src/bimdossier_api/routers/compliance.py:137-162`. The DB transaction (pooled
connection + `SET LOCAL ROLE`/`search_path`) is held for the full Arbiter MCP call
(`arbiter_timeout_seconds=30`). Under concurrency this pins connections (`DB_POOL_SIZE=20`)
to Arbiter latency → pool exhaustion when Arbiter is slow. **Fix:** run the external call,
then open a short transaction to persist the result.

### 18. [API] `list_reports` presigns up to 200 URLs per request with no concurrency cap
`apps/api/src/bimdossier_api/routers/reports.py:355` — `asyncio.gather` over the full page.
Cheap for local S3v4 signing, an unbounded fan-out if the signer ever does a round-trip.
**Fix:** presign lazily, or bound the gather with a semaphore.

### 19. [DevOps] No memory limit / `shm_size` / restart policy on the Puppeteer processor
`docker-compose.yml:59-88`. Chromium + web-ifc WASM at `JOB_CONCURRENCY=2`, no `mem_limit`,
no `shm_size` (Chromium OOMs on the default 64 MB `/dev/shm`), no `restart:`. An OOM-killed
worker is exactly the stuck-job scenario the reconcile sweeper exists to clean up. (Dumb-init
+ SIGTERM handling are correct — that part is solid.) **Fix:** set `shm_size`, mem limits,
and `restart: unless-stopped` in the prod manifest.

### 20. [DevOps] `migrate_all` runs tenants sequentially with no failure isolation
`apps/api/src/bimdossier_api/scripts/migrate_all.py:71-74`. If org #50 fails mid-run, 1-49
are committed and 50-N untouched, leaving the fleet in mixed states with no summary.
**Fix:** collect failures and report a per-schema success/fail summary.

### 21. [DevOps] `ensure_bucket` and migration check only warn, never fail startup
`apps/api/src/bimdossier_api/main.py:82-91`. App starts "healthy" even if storage is
unreachable or schema is behind → passes health checks, then 500s on first upload/query.
Intentional, but a fail-fast on `ensure_bucket` would surface misconfig at deploy time.

### 22. [Portal] `DocumentToolbar` search state not reset on file change
`apps/portal/src/components/shared/viewer/DocumentToolbar.tsx:112-118`. Search results reset
only when `documentHandle` changes, but the toolbar is reused across `fileId` changes. Stale
`searchHits` (page indices from the previous doc) persist; `stepSearch` can call
`onPageChange` with a page index that doesn't exist in the new file. **Fix:** key the reset
on `fileUrl`/`fileId`.

### 23. [Portal] `IfcViewer` remounts on the rotating presigned `fragmentsUrl`
`packages/viewer/src/IfcViewer.tsx:99-207`. Mount effect deps `[fragmentsUrl]`, but that's a
presigned S3 link that rotates on each bundle refetch (`staleTime: 60_000`). A refetch
changes the signature → full viewer teardown + plugin rebuild + re-download mid-session, and
loss of camera/selection state. The stable `fragments_key` is already used for `cacheKey`.
**Fix:** key the mount on `fragments_key`, not the signed URL.

### 24. [Portal] `AttachmentsTab` maps N concurrent uploads onto one mutation's `isPending`
`apps/portal/src/features/projects/detail/AttachmentsTab.tsx:70-92, 149, 165-172`. Loops
`uploadMutation.mutate(...)` per file on the same mutation object; `isPending` reflects only
the last one, so the "Uploading…" banner and disabled button flip off while others are still
in flight, with no per-file error isolation. **Fix:** track an explicit in-flight count, or
use a per-file mutation.

### 25. [Portal] Viewer behavior toggles read `settings` from a stale closure
`apps/portal/src/app/[locale]/(viewer)/.../page.tsx:178-189`. Effect applies persisted
behavior toggles on `[viewerReady]` only but reads async-loaded `settings.behavior`; if
`settings` resolves after `viewerReady` flips, it runs with defaults and never re-applies the
user's persisted toggles. **Fix:** include `settings` (or a ready-flag for it) in deps.

### 26. [Portal] `SettingsDialog` write-back clobbers the non-active viewer mode's settings
`apps/portal/src/components/shared/viewer/settings/SettingsDialog.tsx:428-433, 464-483`. One
`localStorage` key, two independently-mirrored editors; saving the 2D dialog blindly writes
back a reloaded copy of 3D settings, silently reverting any live-applied-but-unpersisted 3D
changes. **Fix:** only persist the mode actually edited.

### 27. [Portal] `DocumentViewer` highlight mutates `span.textContent` of the pdf.js text layer
`packages/viewer/src/DocumentViewer.tsx:387-417`. Rewrites span text to inject `<mark>`s,
relying on cleanup `normalize()` to restore. No cancellation guard against a concurrent
re-render → marks left behind / text doubled across highlight cycles. Lower-confidence;
worth scrutiny since it's WIP. **Fix:** add a cancellation token; avoid mutating the cached
text layer.

---

## LOW / informational

- **[DevOps]** Dev compose publishes every service to `0.0.0.0` (Postgres `bim:bim`, MinIO
  `bimdossier:bimdossier-secret`) — bind to `127.0.0.1:` on shared dev boxes.
- **[DevOps]** No Playwright E2E gate in CI; `turbo.json:7` includes `.env*` in build-cache
  inputs (low risk — gitignored, no `.env` in CI).
- **[DevOps]** Dev seed creds are weak (`Admin123!` etc.) and prefilled in portal
  `.env.local` — correctly gitignored + prod-gated; ensure seed never runs against prod.
- **[API]** `count_consumed_seats` excludes guests; the guest→regular promotion path
  (`organization_members.py:458`) shares the #1 race — fix must cover both entry points.

---

## Verified CORRECT (named targets, no action needed)

- **Tenant `.commit()` hard rule is intact** — every `.commit()` in routers is on a
  master/manually-managed session, never on the `get_tenant_session` dependency.
- **No schema-name SQL injection** — schema names derive only from `schema_name_for()`
  (UUID `.hex`) or the server-set `Organization.schema_name`, never user input.
- **No cross-tenant `search_path` leak in the superuser sweeps** — reconcile / deadline /
  invitation sweepers open a fresh per-org session inside `session.begin()`, so `SET LOCAL`
  is scoped per org; invitation-expiry touches only `public`.
- **Job-state idempotency is actually enforced** (not just claimed) — `jobs_internal.py`
  uses `with_for_update` + terminal-state membership checks; a stale callback cannot
  overwrite a terminal row.
- **`complete_upload` (authenticated file path) is safe** — runs under `get_tenant_session`
  (serialized) and gates on `status is not pending`.
- **Blocklist & refresh-token handling are solid** — fail-closed on Redis errors, refresh
  rejects `imp` claims + re-verifies membership, TTLs use `max(..., 1)`.
- **No real `.env` files are git-tracked** — `.gitignore` excludes them; only `*.env.example`
  templates are committed, with credential keys blank. Worker secret comparison is
  constant-time (`hmac.compare_digest`). No secrets baked into Docker images.
- **All three background sweepers** cancel cleanly on shutdown and isolate per-iteration /
  per-org failures (no silent crash-loop). Compose healthchecks + `depends_on:
  service_healthy` are correct.
- **Tenant migration env** sets `search_path` inside Alembic's own transaction; per-schema
  `alembic_version`. Only destructive op is a safe `DROP INDEX IF EXISTS` in a downgrade.
- **Portal token refresh is single-flighted** (`tokenManager.ts:19-30`). `hasHydrated`
  redirect guard prevents premature redirect / token-less request flash. `DocumentViewer`
  load/render effects cancel properly. Notification socket reconnect/teardown is clean.

---

## Processor / BullMQ worker — PENDING

The dedicated processor audit hit a session limit before producing output. Still to verify
(being completed now):

- BullMQ config: worker concurrency vs puppeteer/web-ifc memory, `attempts`/backoff,
  `removeOnComplete/Fail`, `lockDuration`/`stalledInterval`/`maxStalledCount`.
- At-least-once delivery: is each pipeline idempotent if a job is re-processed after a stall?
- Callback reliability: is the terminal callback POST retried on failure? can a `running`
  callback arrive after a terminal one? are callbacks awaited? (ties to API finding #9.)
- Resource leaks: puppeteer browser/page close on error paths, web-ifc model dispose, temp
  file cleanup, large-file buffering into memory.
- Crash safety: unhandled rejections, SIGTERM draining of in-flight jobs before exit.
