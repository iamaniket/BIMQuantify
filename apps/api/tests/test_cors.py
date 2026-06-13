"""CORS is restricted to the configured allowlist — never wildcard.

Regression guard for the `allow_origins=["*"]` + `allow_credentials=True`
misconfiguration. The critical, env-independent invariant is that the
`Access-Control-Allow-Origin` header is never the literal "*"; the dev/test
allowlist additionally permits localhost, which we assert is reflected.
"""

from httpx import AsyncClient


async def test_preflight_never_reflects_wildcard(client: AsyncClient) -> None:
    resp = await client.options(
        "/health",
        headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert resp.headers.get("access-control-allow-origin") != "*"


async def test_preflight_reflects_allowed_localhost_origin(client: AsyncClient) -> None:
    resp = await client.options(
        "/health",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        },
    )
    acao = resp.headers.get("access-control-allow-origin")
    assert acao == "http://localhost:3000"
    assert acao != "*"
