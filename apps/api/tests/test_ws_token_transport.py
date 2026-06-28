"""M-ws: the /ws/notifications access token moves out of the URL query string.

A token in the URL is logged by proxies, the uvicorn access log, and browser
history. The handshake now prefers the ``Sec-WebSocket-Protocol: bearer, <token>``
channel, keeping the ``?token=`` query as a deprecated fallback for one release.
``_resolve_ws_token`` is the pure resolver — unit-tested here without a live
socket.
"""

from __future__ import annotations

from bimdossier_api.routers.ws_notifications import _resolve_ws_token


def test_bearer_subprotocol_is_preferred() -> None:
    token, accept = _resolve_ws_token(["bearer", "tok-abc"], None)
    assert token == "tok-abc"
    # 'bearer' is echoed on accept; the token itself is never reflected back.
    assert accept == "bearer"


def test_bearer_subprotocol_wins_over_query() -> None:
    token, accept = _resolve_ws_token(["bearer", "from-proto"], "from-query")
    assert token == "from-proto"
    assert accept == "bearer"


def test_query_token_is_a_fallback() -> None:
    token, accept = _resolve_ws_token([], "legacy-tok")
    assert token == "legacy-tok"
    assert accept is None  # no subprotocol to echo on the legacy path


def test_no_credential_returns_none() -> None:
    assert _resolve_ws_token([], None) == (None, None)


def test_non_bearer_subprotocol_ignored() -> None:
    # A subprotocol list that isn't the bearer handshake is not treated as a token.
    token, accept = _resolve_ws_token(["graphql-ws"], None)
    assert token is None
    assert accept is None
