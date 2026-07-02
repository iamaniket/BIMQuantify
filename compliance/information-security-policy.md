# Information Security Policy

**Status:** DRAFT · **Owner:** _(security lead — TBD)_ · **Effective:** _(TBD)_ ·
**Review cadence:** annual

## 1. Purpose & scope

This policy defines how BimDossier protects the confidentiality, integrity, and
availability of customer data and company systems. It applies to all employees,
contractors, and services that process BimDossier data.

## 2. Roles & responsibilities

- **Security lead / DPO** — owns this policy, the incident-response process, and
  the sub-processor register; is the point of contact for data-subject and
  supervisory-authority requests.
- **Engineering** — implements and maintains technical controls (auth, tenancy,
  encryption, logging), follows the change-management policy, and triages security
  scan findings.
- **All staff** — complete security awareness onboarding, use SSO + MFA where
  available, report suspected incidents immediately (see incident-response-plan).

## 3. Data classification

| Class | Examples | Handling |
|-------|----------|----------|
| **Restricted** | Credentials, JWT secrets, customer PII, project documents/IFC/photos | Encrypted in transit + at rest; least-privilege access; never in logs |
| **Confidential** | Internal configs, audit logs, aggregate metrics | Access on need-to-know; retained per the retention schedule |
| **Public** | Marketing site, published docs | No restriction |

Secrets are never committed to git (`.gitignore` + `.dockerignore` exclude `.env`;
`gitleaks` scans every PR). Dev-default secrets fail the production config guard.

## 4. Acceptable use

- Company data is accessed only through approved systems and only as needed for
  one's role.
- Production access to customer data requires a business justification and is
  logged (audit log / impersonation is attributed to the acting admin).
- No customer data is copied to personal devices or unapproved third-party tools.

## 5. Technical control baseline (implemented)

- **Access control** — see `access-control-policy.md`.
- **Encryption** — TLS in transit (enforced by `validate_production_config` for
  token-bearing URLs; `rediss://` + Postgres `sslmode` warnings at boot); at rest
  delegated to the hosting provider (documented in `business-continuity.md`).
- **Tenant isolation** — schema-per-tenant with a non-superuser DB role.
- **Logging & monitoring** — append-only audit log; request-id correlation;
  Sentry error tracking; see `incident-response-plan.md` for alerting.
- **Vulnerability management** — CodeQL, secret scanning, and dependency audits in
  CI; Dependabot for updates; see `change-management-policy.md`.

## 6. Exceptions

Any deviation from this policy must be documented, risk-assessed, time-boxed, and
approved by the security lead.

## 7. Enforcement

Violations may result in revoked access and disciplinary action up to termination,
and — for contractors — contract termination.
