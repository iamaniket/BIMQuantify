# Change Management Policy

**Status:** DRAFT · **Owner:** _(engineering lead — TBD)_ · **Effective:** _(TBD)_ ·
**Review cadence:** annual · **Framework:** SOC 2 CC8, ISO 27001 A.8.28/A.8.32

## 1. Source control & review

- All changes land via pull request to `main`. Direct pushes to `main` are
  disabled by branch protection.
- Every PR requires: passing CI, at least one reviewer approval, and Code Owner
  approval for security-sensitive paths (`.github/CODEOWNERS`).
- No secrets in commits — `gitleaks` runs on every PR and GitHub secret-scanning
  push protection is enabled.

## 2. CI gates (`.github/workflows/ci.yml`)

Per changed area, CI runs:

- **API / Arbiter (Python)** — `ruff check`, `ruff format --check`, `mypy`, `pytest`
  against a live Postgres + Redis.
- **Portal / Web / Processor / Packages (Node)** — build, type-check, lint, and
  unit tests.

Merges are blocked on these checks.

## 3. Security scanning (`.github/workflows/security-scan.yml`)

On every PR, on push to `main`, and weekly:

- **CodeQL** — SAST for JavaScript/TypeScript + Python (`security-and-quality`).
- **gitleaks** — secret scanning (gates merges).
- **pip-audit** (API + Arbiter) and **pnpm audit** — dependency CVEs (informational,
  visible in checks).
- **Dependabot** (`.github/dependabot.yml`) opens update PRs across pip, npm/pnpm,
  and github-actions ecosystems.

## 4. Dependency & build integrity

- Lockfiles are committed and installs are frozen everywhere: CI uses
  `uv sync --frozen` / `pnpm install --frozen-lockfile` / `npm ci`; every
  Dockerfile installs from the lockfile (`--frozen` / `npm ci`).
- pnpm's `allowBuilds` allowlist blocks arbitrary dependency post-install scripts.

## 5. Release & deployment

- **Database migrations** — a deploy that ships a *tenant* migration MUST fan it
  out across every existing org schema after the master upgrade:
  `uv run python -m bimdossier_api.scripts.migrate_all` (and `--check` to detect
  drift). The API logs a loud "TENANT SCHEMAS BEHIND" warning at boot as a
  backstop.
  - **Planned mechanical enforcement (CC8-REL-1 / CC8-CI-1):** run the Alembic
    upgrade chain + `migrate_all --check` and the E2E suite (`test:e2e:full`) as CI
    steps so the release gate is verified pre-merge, not by convention alone.
- **Rollback** — deploys are forward-fix by default; a bad release is rolled back
  by redeploying the previous image tag. Destructive migrations are avoided;
  additive-then-backfill is preferred.
- **Config safety** — `validate_production_config` refuses to boot on insecure
  configuration (dev-default secrets, wildcard CORS/XFF, plaintext token URLs /
  SMTP, non-EU region under `DATA_RESIDENCY=eu`).

## 6. Emergency changes

A hotfix follows the same PR + review + CI path; if a reviewer is unavailable, the
security/engineering lead may approve, and the change is retro-reviewed within one
business day. All emergency changes are logged.
