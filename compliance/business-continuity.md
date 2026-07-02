# Business Continuity & Disaster Recovery

**Status:** DRAFT · **Owner:** _(engineering lead — TBD)_ · **Effective:** _(TBD)_ ·
**Review cadence:** annual + after any DR test · **Framework:** SOC 2 A1,
GDPR Art. 32(1)(c)

> **This is the runbook `config.py` refers to** (the previously-referenced
> `docs/PRODUCTION_READINESS.md` did not exist and `docs/` is git-ignored). Fill in
> the provider-specific values for the Cyso deployment and record a dated restore
> test before launch (A1-DR-1).

## 1. Targets (proposed — confirm with the business)

| Metric | Target |
|--------|--------|
| **RPO** (max acceptable data loss) | ≤ 15 minutes (Postgres PITR) |
| **RTO** (max acceptable downtime) | ≤ 4 hours |

## 2. What must be backed up

| Asset | Mechanism | Notes |
|-------|-----------|-------|
| **Postgres** (all tenant schemas + public master tables + `alembic_version`) | Managed PITR / WAL archiving (or pgBackRest/wal-g) | Per-org logical restore = `pg_dump --schema=org_<hex>` + the `public` master tables; a partial restore must keep `alembic_version` consistent |
| **Object storage** (`s3_bucket_ifc`, `s3_bucket_attachments`) | Versioning and/or cross-site replication | Restore consistently with the DB rows that reference the keys |
| **Redis** | AOF persistence + HA/failover | Holds rate-limit state, JTI blocklist, refresh-rotation state, and the BullMQ queue; a single-node Redis is a SPOF for the whole authenticated surface |

Backups must themselves be **encrypted at rest** and access-controlled.

## 3. Encryption at rest (ENC-ATREST-1)

The product claims data is encrypted at rest; substantiate it here:

- **Database & disks** — enable provider disk / managed-Postgres encryption (Cyso).
- **Object storage** — enable default bucket encryption (SSE); `ensure_bucket` is
  the place to call `put_bucket_encryption` when the backend supports it, with a
  boot-time `GetBucketEncryption` warning as a check.
- Record the encryption mechanism + key management here for the auditor.

## 4. Restore procedure (fill in + test)

1. Provision a clean environment (DB, Redis, object storage, app/processor images).
2. Restore Postgres to the target point-in-time; verify `alembic_version` and run
   `migrate_all --check`.
3. Restore object storage to a consistent point relative to the DB.
4. Bring up the API/processor; run smoke tests (`/health/ready` returns 200,
   a project loads, a document downloads).
5. **Record the date, operator, restored point, and outcome of each DR test.**
   SOC 2 A1.3 requires evidence of at least one successful restore test.

## 5. High availability & degradation

- Stateless app + processor scale horizontally; background sweepers are
  leader-elected (`pg_try_advisory_xact_lock`) so multiple replicas don't
  duplicate work.
- Redis outage: the rate limiter fails **open** (a throttle is not an auth gate)
  while the JWT blocklist fails **closed** (a revoked token must never be honored).
- Storage/DB outage surfaces on `/health/ready` (503) for orchestrator failover.

## 6. Data residency

For the EU-only residency claim: keep Postgres, object storage, Redis, backups,
Sentry (EU region), and any SMTP relay within the EU. Set `DATA_RESIDENCY=eu` so
`validate_production_config` enforces the S3 region + Sentry DSN region at boot.
