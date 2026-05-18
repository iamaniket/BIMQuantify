# Jurisdictions registry

Registry of countries the API can serve. Each country lives in its own
module (e.g. `nl.py`) and calls `register(Jurisdiction(...))` at import.

## Updating toegelaten instrumenten (NL)

The Wkb register of admitted instruments — TloKB
(<https://www.tlokb.nl/register>) — changes ~twice a year. To pick up a
change:

1. Edit `NL_INSTRUMENTS` in `nl.py`. Add/remove an `Instrument(...)`
   entry. The `id` is the stable slug stored on `Project.instrument_id`
   — never rename an existing one without a data migration.
2. Mirror the same change in the portal at
   `apps/portal/src/features/projects/wizard/projectWizardSteps.ts`
   (`INSTRUMENT_OPTIONS`). Server-side validation rejects ids that
   aren't in `NL_INSTRUMENTS`, so a portal-only entry would 422.
3. Bump the "last reviewed" date in the comment above `NL_INSTRUMENTS`.
4. Run the project tests:
   `uv run pytest tests/test_projects.py -k instrument`.

There is no scheduled scrape of the TloKB register — the manual review
is the point, so we never silently absorb a registry change.

## Adding a new country

Drop a sibling module (e.g. `de.py`) that constructs a `Jurisdiction`
and calls `register(...)`. Import it from `__init__.py` so the registry
populates at startup. No schema changes are required — the project
data model (`country`, `instrument_id`, framework on `Job.payload`) is
jurisdiction-blind.
