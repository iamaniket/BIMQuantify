# Vendor / Sub-processor Management

**Status:** DRAFT · **Owner:** _(DPO / security lead — TBD)_ · **Effective:** _(TBD)_ ·
**Review cadence:** annual · **Framework:** GDPR Art. 28, SOC 2 CC9

## 1. Onboarding a vendor that processes personal data

Before any customer personal data flows to a new third party:

1. **Justify** the need and the minimum data categories required.
2. **Risk-assess** the vendor: security posture (SOC 2 / ISO 27001 report if
   available), data location (must support EU residency — see below), breach-
   notification terms, sub-processor chain.
3. **Sign a Data Processing Agreement (Art. 28)** with EU Standard Contractual
   Clauses if any processing/transfer touches outside the EEA.
4. **Add the vendor to** `subprocessors.md` and the published portal list, and give
   customers the contractually-required advance notice so they can object.

## 2. EU data residency

BimDossier advertises EU-only data residency. Every vendor that stores or processes
customer data must keep it in the EU/EEA (or provide an adequacy/SCC basis).
Enforced technically by `DATA_RESIDENCY=eu` (S3 region + Sentry DSN region checked
at boot).

## 3. Ongoing review

- **Annually**, re-confirm each vendor's DPA is current, its region is still EU, its
  security posture is unchanged, and it is still needed.
- Track vendor incidents/breaches and feed them into the incident-response process.
- Remove and offboard vendors no longer in use (revoke API keys, confirm data
  deletion).

## 4. Current vendors

See `subprocessors.md` for the live list (hosting, object storage, error
monitoring, analytics, email).
