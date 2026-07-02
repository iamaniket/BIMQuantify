# Data Retention Schedule

**Status:** DRAFT · **Owner:** _(DPO — TBD)_ · **Effective:** _(TBD)_ ·
**Review cadence:** annual · **Framework:** GDPR Art. 5(1)(e) (storage limitation)

Personal data is kept only as long as necessary for the purpose it was collected
for (plus any legal-retention obligation). This schedule sets the target windows;
the retention sweeper (GDPR-RET-AUDIT-1, planned) enforces them.

| Data category | Where | Retention target | Notes / lawful basis |
|---------------|-------|------------------|----------------------|
| **Active account** (user profile, memberships) | `public.users`, `organization_members` | Life of the account | Anonymized on account deletion (`auth/manager.py` scrubs PII, kills sessions, cascades pooled data + S3 prefix) |
| **Project data** (documents, IFC, findings, photos, certificates) | Tenant schema + object storage | Life of the org + `ORG_RETENTION_DAYS` (30) after org deletion, then hard purge | Wkb dossier evidence may warrant a longer contractual/legal window — confirm |
| **Audit log** (IP, user-agent, actor, attempted-login emails) | `audit_log` (append-only) | **Tiered (planned):** platform-schema auth noise 90–365 days; tenant project trail up to 10 years (Wkb) | Currently retained indefinitely — the systemic gap this schedule closes |
| **Notifications** | `notifications`, `notification_user_state` | 12 months (proposed) | Currently indefinite |
| **Marketing leads** (access requests: name, work email, company, notes) | `access_requests` | 12–24 months after last contact (proposed) | Currently no deletion path (GDPR-RET-LEADS-1) |
| **Expired free-trial accounts** | pooled tables | Anonymize/purge N days after trial end (proposed) | Currently retained indefinitely (GDPR-RET-FREEACCT-1) |
| **Anonymous capture uploads** (device metadata, EXIF/geo of unauthenticated visitors) | attachments | Minimize at capture; delete unclaimed after a short window | GDPR-CAPTURE-META-1 — data minimization |
| **Backups** | provider | Rolling window matching RPO/DR policy | Encrypted; see `business-continuity.md` |
| **Email logs** | relay provider | Per provider default (minimize) | Confirm provider retention |

## Enforcement (planned — GDPR-RET-AUDIT-1)

- A **leader-elected retention sweeper** (`background/periodic.py` shape) purges
  rows past their window across **all** org schemas *and* the platform schema.
- The `audit_log` append-only trigger (`_rls_sql.py`) blocks row deletes for all
  roles, so the sweeper must either (a) delete under a maintenance GUC the trigger
  permits only for the sweeper connection, or (b) use monthly range partitions and
  `DROP` old partitions.
- Erasure residue (PII copies in `audit_log` before/after JSONB and notification
  bodies) is bounded by these windows and documented under Art. 17(3)(b); the
  account-deletion path also deletes the avatar object (GDPR-ERASE-AVATAR-1).

## Data-subject rights

- **Erasure (Art. 17)** — account anonymization exists (superuser-triggered today;
  a self-service path is planned, GDPR-ERASE-SELF-1).
- **Access/portability (Art. 15/20)** — a per-project findings export exists; a full
  data-subject export / org takeout is planned (GDPR-EXPORT-1).
