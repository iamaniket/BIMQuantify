# Access Control Policy

**Status:** DRAFT · **Owner:** _(security lead — TBD)_ · **Effective:** _(TBD)_ ·
**Review cadence:** annual · **Framework:** SOC 2 CC6

## 1. Principles

- **Least privilege** — every principal (human or service) gets the minimum
  access needed for its function.
- **Need to know** — production customer data is accessed only with a business
  justification, and such access is logged.
- **Separation of duties** — the same person should not both author and unilaterally
  release a change to production (see `change-management-policy.md`).

## 2. User access lifecycle

- **Provisioning** — there is no public self-registration for the paid product;
  users arrive by admin invite (`auth/routes.py`, invite → activation flow). New
  hires get company-system access via SSO, granted per role.
- **Authentication** — email + password today, with:
  - 12-character minimum password (`auth/manager.py`),
  - per-account login lockout with exponential backoff + admin alert,
  - per-IP + per-account brute-force throttling,
  - access/refresh JWTs with separate audiences; refresh-token rotation with
    reuse detection; a fail-closed JTI blocklist; a per-user token epoch that
    signs out every session on password change / deprovision.
- **MFA (planned — CC6-MFA-1)** — TOTP/WebAuthn, enforced first for every
  `is_superuser` account (largest blast radius), then offered/required for org
  admins. Interim compensating control until shipped: restrict `/admin/*` at the
  reverse proxy to a VPN / IP allowlist.
- **Deprovisioning** — removing an org membership hard-deletes the membership row;
  the next request 403s even with a still-valid token (live membership re-check in
  `tenancy.py`). Account deactivation and password change bump the token epoch.
  Offboarding a staff member revokes SSO + all production access same-day.

## 3. Privileged / administrative access

- Super-admin actions (org purge, impersonation, user promote/demote) are
  audit-logged; impersonation is access-token-only, short-TTL, cannot target
  another superuser, and is fully attributed to the impersonator.
- **Planned (CC6-ADMIN-AUDIT-1)** — the generic `PATCH /users/{id}` is being
  restricted so privileged flags (`is_superuser`/`is_active`) can only change via
  the purpose-built, invariant-enforcing admin handlers.
- Service-to-service auth uses shared bearer secrets (`PROCESSOR_SHARED_SECRET`,
  `ARBITER_SHARED_SECRET`), constant-time compared, fail-closed in production.
  JWT signing secret supports rotation via `JWT_SECRET_PREVIOUS`.

## 4. Access reviews

- **Quarterly**, the security lead reviews: who has production/admin access, who
  has `is_superuser`, org-membership admin roles, and third-party integrations.
- Findings (stale accounts, over-broad grants) are remediated within 5 business
  days and the review is recorded as SOC 2 evidence.
- _(CC6-ACCESS-REVIEW-1: a consolidated "who can access what" report endpoint is a
  planned enhancement to make this review one-click.)_

## 5. Session management

- Access tokens are short-lived (default 15 min); refresh tokens have a 7-day
  **absolute** cap that rotation (and org-switch, per AUTH-SESS-1) never extends.
- WebSocket notification sockets re-authenticate on an interval and are lifetime-
  capped below the access-token TTL.
- _(Planned: an admin "terminate all sessions for this user" control and an idle
  timeout; deactivation should also bump the token epoch — CC6-ADMIN-REVOKE-1.)_
