# Sub-processors

**Status:** DRAFT — confirm every entry before publishing · **Owner:** _(DPO — TBD)_ ·
**Framework:** GDPR Art. 28

This is the list of third parties that may process customer personal data on
BimDossier's behalf. A cleaned-up version of this table should be **published on the
portal** (e.g. `/legal/subprocessors`, reusing `LegalArticle`) and referenced from
the privacy policy and DPA — today the privacy policy says the list is "included in
the DPA" while the DPA says it is "available on request"; both must point here
(GDPR28-DPA-1).

> Entries are derived from code/config and MUST be confirmed against the actual
> production contracts. Purpose and region are the two an auditor checks first.

| Sub-processor | Purpose | Data categories | Region | Status |
|---------------|---------|-----------------|--------|--------|
| **Cyso** (hosting/infra) | Compute, database, object storage, backups | All customer data at rest/in processing | EU (NL) | Confirm contract + DPA |
| **Object storage** (S3-compatible) | Project files, IFC models, photos, certificates | Restricted (documents, images incl. possible EXIF) | EU — set an `eu-*` region | Confirm provider (Cyso vs separate) |
| **Sentry** | Error monitoring | Diagnostic data; `send_default_pii=False`, no request bodies | EU data region required | Confirm EU DSN + DPA |
| **PostHog** | Product analytics (portal) | Identified events (email/name/org for signed-in users); cookieless, memory persistence | EU (`eu.i.posthog.com`) | Confirm DPA; disclose in privacy policy |
| **Email relay** (Postmark or SMTP relay) | Transactional email (activation, reset, invites, reminders) | Recipient email + message content | Confirm EU | Confirm provider + DPA + TLS |

## Change process

- Adding or replacing a sub-processor follows `vendor-management.md` (risk review +
  DPA before any customer data flows).
- Notify customers of a new sub-processor per the DPA notice terms before it starts
  processing, so they can object.
- Keep this list and the published portal page in sync (single source of truth).
