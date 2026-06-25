"""BCF models follow the app conventions before the BCF router ships:

- every FK relationship forces explicit eager loading (`lazy="raise"`), so a
  forgotten `selectinload` fails loudly instead of silently doing N+1 / raising
  MissingGreenlet under an async session;
- every foreign-key column is indexed.

(The BCF router doesn't exist yet; behavioral selectinload-vs-raise coverage
arrives with it. This locks the declarative convention in now, while it's cheap.)
"""

from __future__ import annotations

from sqlalchemy import inspect

# Importing the package registers the whole mapper registry so the relationship
# string targets (Project, Finding, Document, ...) resolve during introspection.
from bimdossier_api.models import BcfComment, BcfTopic, BcfViewpoint


def _lazy_by_key(model: type) -> dict[str, object]:
    return {rel.key: rel.lazy for rel in inspect(model).relationships}


def _indexed_columns(model: type) -> set[str]:
    return {col.name for ix in model.__table__.indexes for col in ix.columns}


def test_bcf_relationships_force_eager_loading() -> None:
    # Relationships intentionally eager (not "raise"): the label rows back the
    # read-only `BcfTopic.labels` property, so they're `selectin` by design.
    allowed_eager: dict[type, set[str]] = {BcfTopic: {"label_rows"}}
    for model in (BcfTopic, BcfComment, BcfViewpoint):
        lazies = _lazy_by_key(model)
        assert lazies, f"{model.__name__} has no relationships"
        exempt = allowed_eager.get(model, set())
        for key, lazy in lazies.items():
            if key in exempt:
                continue
            assert lazy == "raise", f"{model.__name__}.{key} is lazy={lazy!r}; expected 'raise'"


def test_bcf_foreign_keys_are_indexed() -> None:
    assert {
        "project_id",
        "linked_finding_id",
        "linked_document_id",
        "linked_file_id",
        "created_by_user_id",
    } <= _indexed_columns(BcfTopic)
    assert {"topic_id", "created_by_user_id"} <= _indexed_columns(BcfComment)
    assert {"topic_id", "linked_file_id"} <= _indexed_columns(BcfViewpoint)
