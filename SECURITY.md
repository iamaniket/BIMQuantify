# Security Policy

BimDossier is a multi-tenant construction-quality (Wkb/BBL) platform handling
customer project data. We take security seriously and welcome responsible
disclosure.

> **Pre-launch note:** the `security@bimdossier.nl` mailbox and the production
> domain in `apps/web/public/.well-known/security.txt` are placeholders until
> launch — confirm both are live before flipping `PRELAUNCH_LOCK`.

## Reporting a vulnerability

Please email **security@bimdossier.nl** with:

- a description of the issue and its impact,
- steps to reproduce (proof-of-concept if possible), and
- any relevant logs, request IDs (`X-Request-Id`), or screenshots.

We aim to acknowledge reports within **2 business days** and to provide a
remediation timeline within **10 business days**. Please give us a reasonable
window to fix an issue before public disclosure.

Machine-readable contact details follow RFC 9116:
<https://bimdossier.nl/.well-known/security.txt>.

## Scope

In scope: the API (`apps/api`), portal (`apps/portal`), marketing site
(`apps/web`), background processor (`apps/processor`), compliance service
(`apps/arbiter`), and mobile app (`apps/mobile`).

Out of scope: automated scanner output without a demonstrated impact, social
engineering, physical attacks, and denial-of-service testing against production.

## Please do not

- Access, modify, or delete data belonging to another tenant/organization.
- Run automated load/DoS tests against production infrastructure.
- Exfiltrate more data than necessary to demonstrate a finding.

## Supported versions

The `main` branch is the only supported version; fixes ship forward from there.

## Our commitments

- We will not pursue legal action against good-faith researchers who follow this
  policy.
- We will keep you informed of remediation progress and credit you (with your
  permission) once a fix ships.

Internal handling of reports follows our incident-response process
(`compliance/incident-response-plan.md`).
