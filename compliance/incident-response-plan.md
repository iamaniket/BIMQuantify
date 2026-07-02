# Incident Response Plan

**Status:** DRAFT · **Owner:** _(security lead — TBD)_ · **Effective:** _(TBD)_ ·
**Review cadence:** annual + after every incident · **Framework:** SOC 2 CC7,
GDPR Art. 33/34

## 1. Definitions

- **Security event** — an observable occurrence that may affect security (a failed
  login spike, a scanner alert, an anomalous admin action).
- **Incident** — an event confirmed to compromise confidentiality, integrity, or
  availability of systems or data.
- **Personal-data breach** — an incident leading to accidental/unlawful
  destruction, loss, alteration, or unauthorized disclosure of / access to personal
  data (triggers GDPR Art. 33/34 obligations).

## 2. Detection sources

- **Sentry** — application + processor error tracking (`observability.py`,
  `apps/processor/src/sentry.ts`); `send_default_pii` is off.
- **Audit log** — append-only `audit_log` (login success/failure, password/token
  events, membership + privilege changes, exports, admin actions), request-id
  correlated with logs and Sentry.
- **Account lockout alerts** — repeated failed logins trigger an alert today.
- **Security scanning** — CodeQL / gitleaks / dependency-audit findings.
- **External** — reports to `security@bimdossier.nl` (see `/SECURITY.md`).

> **Gap to close (CC7-ALERT-1 / A1-MON-1):** confirmed refresh-token reuse (the
> strongest theft signal) currently writes a silent audit row — add an alert.
> Add external uptime checks against `/health/ready` + processor `/healthz`, and
> Sentry cron monitors around the leader-elected sweepers. Document who is paged.

## 3. Roles

- **Incident lead** — security lead (or delegate); coordinates the response and
  decides on breach notification.
- **Engineering responder(s)** — investigate, contain, and remediate.
- **Comms** — handles customer and (if needed) supervisory-authority / press comms.

## 4. Response workflow

1. **Identify & triage** — record time, source, and initial severity. Open a
   private incident ticket.
2. **Contain** — revoke compromised credentials/sessions (bump the user token
   epoch / rotate `JWT_SECRET` via `JWT_SECRET_PREVIOUS`; rotate service secrets),
   isolate affected components, block malicious IPs at the proxy.
3. **Eradicate & recover** — fix the root cause, restore from backups if needed
   (see `business-continuity.md`), verify integrity before returning to service.
4. **Assess personal-data impact** — determine whether personal data was affected,
   which data subjects, and the likely risk to their rights and freedoms.
5. **Notify** — see §5.
6. **Post-incident review** — within 5 business days: timeline, root cause,
   what worked, corrective actions with owners and dates. Update this plan.

## 5. GDPR breach notification (Art. 33/34)

- If a personal-data breach is likely to result in a risk to individuals, notify
  the Dutch supervisory authority (**Autoriteit Persoonsgegevens**) **without undue
  delay and within 72 hours** of becoming aware.
- If the breach is a **high** risk to individuals, also notify the affected data
  subjects without undue delay, in clear language.
- As a **processor**, notify affected **controllers** (customers) without undue
  delay so they can meet their own obligations (mirrors the DPA commitment).
- Maintain an internal breach register (date, nature, categories/volume of data
  and subjects, consequences, measures taken) regardless of whether external
  notification was required.

## 6. Contacts

- Internal security: `security@bimdossier.nl` _(confirm mailbox is live pre-launch)_
- Supervisory authority: Autoriteit Persoonsgegevens (autoriteitpersoonsgegevens.nl)
- Hosting/DB provider support: _(Cyso — add account + support channel)_
