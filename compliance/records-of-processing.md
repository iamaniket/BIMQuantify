# Records of Processing Activities (RoPA)

**Status:** DRAFT · **Owner:** _(DPO — TBD)_ · **Effective:** _(TBD)_ ·
**Review cadence:** annual · **Framework:** GDPR Art. 30

BimDossier acts as a **processor** for customer project data (the customer
organization is the controller) and as a **controller** for its own account,
billing, and marketing data. This record covers both roles.

## Controller identity

- **Entity:** BimDossier _(trading name; legal entity + KvK number pending
  registration — fill in before publishing the privacy policy, GDPR13-PRIV-1)_
- **Contact / DPO:** `security@bimdossier.nl` _(confirm mailbox live)_

## Processing activities (as controller)

| Activity | Purpose | Data subjects | Categories | Lawful basis (Art. 6) | Retention |
|----------|---------|---------------|------------|-----------------------|-----------|
| Account management | Provide the service | Users | Name, email, org membership, locale | 6(1)(b) contract | Life of account |
| Authentication & security | Protect accounts | Users | Credentials (hashed), IP, user-agent, audit events | 6(1)(f) legitimate interest; 6(1)(c) where legally required | Per retention schedule |
| Product analytics | Improve the product | Portal users | Identified events (email/name/org), page/interaction data (PostHog, EU, cookieless) | 6(1)(f) legitimate interest (with opt-out, planned EPRIV-PH-1) | Per PostHog config |
| Error monitoring | Reliability | Users | Diagnostic data (Sentry, PII off) | 6(1)(f) legitimate interest | Per Sentry config |
| Marketing / access requests | Sales follow-up | Prospects | Name, work email, company, role, notes | 6(1)(f) / 6(1)(a) consent | 12–24 months (proposed) |
| Transactional email | Onboarding & notifications | Users | Email, message content | 6(1)(b) contract | Per relay provider |

## Processing activities (as processor, on behalf of customers)

| Activity | Purpose | Data subjects | Categories | Retention |
|----------|---------|---------------|------------|-----------|
| Hosting project data | Deliver Wkb/BBL quality management | Customer's staff, contractors, and any individuals in uploaded documents/photos | Project documents, IFC models, findings, photos (possible EXIF/geo), certificates, contact details | Life of the customer org + `ORG_RETENTION_DAYS`, then purge |

## Transfers

All processing is intended to stay within the EU/EEA (see `vendor-management.md`
and `subprocessors.md`). Any transfer outside the EEA requires an adequacy decision
or SCCs.

## Technical & organizational measures (Art. 32)

Summarized in `information-security-policy.md` §5 and evidenced in the codebase:
tenant isolation, encryption in transit (+ at rest via provider), access control +
MFA (planned), audit logging, retention limits (planned), and the incident-response
process.
