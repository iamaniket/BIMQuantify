"""Security-response-header values applied to every API response (finding B5).

Header VALUES live here as constants (not env-configured) so the security posture
is reviewable in one place and can't be weakened by a stray env var. Only HSTS
max-age is configurable (via ``Settings.hsts_max_age_seconds``) because it's the
one value an operator legitimately tunes during a TLS rollout.

The API serves JSON only, so its own CSP is maximally strict (``default-src
'none'``). The sole exception is FastAPI's interactive docs (``/docs``,
``/redoc``), whose Swagger-UI / ReDoc bundles load from the jsdelivr CDN and use
inline styles/scripts — those paths get a relaxed CSP so the docs keep rendering.
"""

from __future__ import annotations

# --- Strict CSP for all JSON API responses --------------------------------
# A JSON API never sources scripts/styles/images, so deny everything. Belt-and-
# braces against an attacker who finds a way to get HTML reflected: nothing can
# load, nothing can be framed, <base> can't be hijacked.
API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"

# --- Relaxed CSP for the interactive docs ---------------------------------
# FastAPI's get_swagger_ui_html / get_redoc_html pull the bundle + inline init
# script from https://cdn.jsdelivr.net and use inline styles. Swagger UI fetches
# its OpenAPI JSON same-origin; the favicon comes from fastapi.tiangolo.com.
# `worker-src blob:` covers Swagger UI's web-worker usage in some versions.
DOCS_CSP = (
    "default-src 'none'; "
    "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
    "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
    "img-src 'self' https://cdn.jsdelivr.net https://fastapi.tiangolo.com data:; "
    "font-src 'self' https://cdn.jsdelivr.net; "
    "connect-src 'self'; "
    "worker-src 'self' blob:; "
    "frame-ancestors 'none'; "
    "base-uri 'none'"
)

# Paths whose responses get DOCS_CSP instead of API_CSP. Prefix match (via
# str.startswith(tuple)) so /docs/oauth2-redirect and any sub-paths are covered.
DOCS_PATH_PREFIXES = ("/docs", "/redoc", "/openapi.json")

# --- Non-CSP headers (identical on every response) ------------------------
# Lock down browser features the API never legitimately needs from a response.
PERMISSIONS_POLICY = (
    "accelerometer=(), autoplay=(), camera=(), display-capture=(), "
    "encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), "
    "magnetometer=(), microphone=(), midi=(), payment=(), "
    "picture-in-picture=(), usb=()"
)

# X-Frame-Options is redundant with `frame-ancestors 'none'` but harmless and
# still honored by a few legacy scanners/agents; keep it as belt-and-braces.
STATIC_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": PERMISSIONS_POLICY,
}


def hsts_value(max_age_seconds: int) -> str:
    """HSTS with includeSubDomains, no preload.

    Omitting ``preload`` is deliberate: preload is an irreversible, browser-baked
    commitment that's slow to undo. includeSubDomains is always on.
    """
    return f"max-age={max_age_seconds}; includeSubDomains"
