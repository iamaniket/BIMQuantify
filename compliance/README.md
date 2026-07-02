# BimDossier Compliance & Governance

This directory holds BimDossier's internal governance policies and the evidence an
auditor (SOC 2) or supervisory authority (GDPR/AVG) would ask to see. It is a
**tracked** location on purpose — `docs/` is git-ignored, so auditor-facing
material lives here instead.

> **Status: DRAFT.** These are engineering-authored starting points, grounded in
> the controls actually implemented in this repo. They must be reviewed and
> finalized by the company's Dutch IT-law counsel / a compliance owner before they
> are presented as authoritative. Owner and effective dates are placeholders.

## Contents

| Document | Purpose | Framework |
|----------|---------|-----------|
| [information-security-policy.md](information-security-policy.md) | Roles, acceptable use, data classification | SOC 2 CC1/CC5, ISO 27001 A.5 |
| [access-control-policy.md](access-control-policy.md) | Provisioning, least privilege, MFA, access reviews, offboarding | SOC 2 CC6 |
| [change-management-policy.md](change-management-policy.md) | Branch protection, review, CI gates, release gate | SOC 2 CC8 |
| [incident-response-plan.md](incident-response-plan.md) | Detection → triage → GDPR 72-hour breach notification | SOC 2 CC7, GDPR Art. 33/34 |
| [business-continuity.md](business-continuity.md) | Backup/DR, RPO/RTO | SOC 2 A1, GDPR Art. 32(1)(c) |
| [vendor-management.md](vendor-management.md) | Sub-processor onboarding + review | GDPR Art. 28, SOC 2 CC9 |
| [subprocessors.md](subprocessors.md) | Named sub-processor list (publish on the portal) | GDPR Art. 28 |
| [data-retention-schedule.md](data-retention-schedule.md) | Retention window per data category | GDPR Art. 5(1)(e) |
| [records-of-processing.md](records-of-processing.md) | Records of processing activities (RoPA) | GDPR Art. 30 |

## How the code maps to these controls

Many of these policies describe controls that are already implemented and tested
in the codebase — cite these when responding to a security questionnaire:

- **Tenant isolation** — schema-per-tenant (`tenancy.py`), org derived from the JWT
  claim only, `SET LOCAL ROLE bim_app` (non-superuser), RLS on the shared tables.
- **Authentication** — access/refresh JWTs with separate audiences, refresh-token
  rotation + reuse detection, fail-closed JTI blocklist, per-user token epoch
  ("sign out everywhere"), 12-char password minimum, per-account login lockout.
- **Transport / secrets** — `validate_production_config` fails closed on dev-default
  secrets, wildcard CORS/XFF, plaintext token URLs, plaintext SMTP, and non-EU
  region when `DATA_RESIDENCY=eu`; JWT secret rotation via `JWT_SECRET_PREVIOUS`.
- **Audit logging** — append-only `audit_log` (DB trigger + REVOKE), request-id
  correlated across logs / audit / Sentry.
- **Input hardening** — per-field caps (`schemas/_limits.py`), download content-type
  neutralization (`content_disposition.py`), CSV formula-injection neutralization
  (`csv_safety.py`), MIME-format validation on uploads.
- **Supply chain** — CI (`.github/workflows/ci.yml`), security scanning
  (`security-scan.yml`: CodeQL + gitleaks + pip-audit + pnpm audit), Dependabot,
  CODEOWNERS, frozen lockfiles in every Docker build.
