"""Security-response headers are present on every API response (finding B5).

The `client` fixture speaks http (base_url http://test), so HSTS — gated on
https — must be ABSENT there; that absence is itself the assertion that the
scheme gate works. An absolute https URL exercises the present case. CSP is
strict for JSON routes and relaxed for the interactive docs.
"""

from httpx import AsyncClient

from bimdossier_api.security_headers import API_CSP, DOCS_CSP


async def test_static_security_headers_present(client: AsyncClient) -> None:
    resp = await client.get("/health")
    assert resp.headers.get("x-content-type-options") == "nosniff"
    assert resp.headers.get("x-frame-options") == "DENY"
    assert resp.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
    assert "camera=()" in resp.headers.get("permissions-policy", "")


async def test_api_csp_is_strict_on_json_routes(client: AsyncClient) -> None:
    resp = await client.get("/health")
    assert resp.headers.get("content-security-policy") == API_CSP
    assert "default-src 'none'" in resp.headers["content-security-policy"]


async def test_hsts_absent_over_http(client: AsyncClient) -> None:
    # Gate is request.url.scheme == "https"; the test client is http://test.
    resp = await client.get("/health")
    assert "strict-transport-security" not in resp.headers


async def test_hsts_present_over_https(client: AsyncClient) -> None:
    # An absolute https URL makes ASGITransport set scope["scheme"] = "https",
    # the same value uvicorn derives from X-Forwarded-Proto in prod.
    resp = await client.get("https://test/health")
    hsts = resp.headers.get("strict-transport-security")
    assert hsts is not None
    assert "max-age=" in hsts
    assert "includeSubDomains" in hsts
    assert "preload" not in hsts


async def test_docs_get_relaxed_csp(client: AsyncClient) -> None:
    resp = await client.get("/docs")
    assert resp.headers.get("content-security-policy") == DOCS_CSP
    assert "cdn.jsdelivr.net" in resp.headers["content-security-policy"]


async def test_redoc_gets_relaxed_csp(client: AsyncClient) -> None:
    # /redoc, like /docs, is a static HTML page (no server-side schema gen), so
    # it exercises a second path under DOCS_PATH_PREFIXES.
    resp = await client.get("/redoc")
    assert resp.headers.get("content-security-policy") == DOCS_CSP
    assert "cdn.jsdelivr.net" in resp.headers["content-security-policy"]


async def test_headers_present_on_404(client: AsyncClient) -> None:
    # Exception-handler responses must still carry the headers — the middleware
    # is registered outermost, so it wraps the localized exception handlers.
    resp = await client.get("/this-route-does-not-exist")
    assert resp.status_code == 404
    assert resp.headers.get("x-content-type-options") == "nosniff"
    assert resp.headers.get("content-security-policy") == API_CSP
