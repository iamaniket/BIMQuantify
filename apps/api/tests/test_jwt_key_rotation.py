"""ENC-KEY-1: JWT signing-secret rotation via a verify-only previous secret."""

from __future__ import annotations

from uuid import uuid4

import pytest

from bimdossier_api.auth import tokens as tokens_mod
from bimdossier_api.config import get_settings

_OLD = "old-secret-" + "x" * 32
_NEW = "new-secret-" + "y" * 32


def _use_settings(monkeypatch: pytest.MonkeyPatch, **overrides: object) -> None:
    base = get_settings().model_copy(update=overrides)
    monkeypatch.setattr(tokens_mod, "get_settings", lambda: base)


def test_token_minted_under_previous_secret_still_verifies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Mint under the OLD secret (pre-rotation).
    _use_settings(monkeypatch, jwt_secret=_OLD, jwt_secret_previous=None)
    token = tokens_mod.create_token(uuid4(), "access")

    # Rotate: NEW is primary, OLD becomes the verify-only previous secret.
    _use_settings(monkeypatch, jwt_secret=_NEW, jwt_secret_previous=_OLD)
    decoded = tokens_mod.decode_token_full(token, "access")
    assert decoded.jti is not None


def test_new_tokens_are_minted_under_the_current_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _use_settings(monkeypatch, jwt_secret=_NEW, jwt_secret_previous=_OLD)
    token = tokens_mod.create_token(uuid4(), "refresh")
    # Drop the previous secret entirely (rotation complete) — the token minted
    # under the current secret must still verify.
    _use_settings(monkeypatch, jwt_secret=_NEW, jwt_secret_previous=None)
    assert tokens_mod.decode_token_full(token, "refresh").jti is not None


def test_token_under_unknown_secret_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_settings(monkeypatch, jwt_secret=_OLD, jwt_secret_previous=None)
    token = tokens_mod.create_token(uuid4(), "access")
    # Neither the current nor the previous secret matches the one it was signed with.
    _use_settings(monkeypatch, jwt_secret=_NEW, jwt_secret_previous="a-third-unrelated-secret-zz")
    with pytest.raises(tokens_mod.TokenError):
        tokens_mod.decode_token_full(token, "access")
