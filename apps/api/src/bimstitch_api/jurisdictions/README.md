# Jurisdictions registry

Registry of countries the API can serve. Each country lives in its own
module (e.g. `nl.py`) and calls `register(Jurisdiction(...))` at import.

## Adding a new country

Drop a sibling module (e.g. `de.py`) that constructs a `Jurisdiction`
and calls `register(...)`. Import it from `__init__.py` so the registry
populates at startup. No schema changes are required — the project
data model (`country`, framework on `Job.payload`) is jurisdiction-blind.
