"""Behavior tests for the localized error envelope and Accept-Language
resolution. Self-contained — builds a tiny app that raises the same way the
real routers do, so it needs no DB or fixtures.
"""

from __future__ import annotations

import json

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from bimdossier_api.i18n.http_errors import (
    generic_exception_handler,
    http_exception_handler,
    validation_exception_handler,
)


def _make_client() -> TestClient:
    app = FastAPI()
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, generic_exception_handler)

    @app.get("/string-code")
    async def _string_code() -> None:
        raise HTTPException(status_code=404, detail="PROJECT_NOT_FOUND")

    @app.get("/dict-code")
    async def _dict_code() -> None:
        raise HTTPException(
            status_code=409,
            detail={"code": "DUPLICATE_FILE_CONTENT", "existing_file_id": "abc"},
        )

    @app.get("/colon-code")
    async def _colon_code() -> None:
        raise HTTPException(status_code=422, detail="CUSTOM_FIELD_REQUIRED:field-123")

    @app.get("/unknown-code")
    async def _unknown_code() -> None:
        raise HTTPException(status_code=400, detail="TOTALLY_UNKNOWN_CODE")

    class Body(BaseModel):
        n: int

    @app.post("/validate")
    async def _validate(body: Body) -> None:
        return None

    class SecretBody(BaseModel):
        password: str = Field(min_length=8)

    @app.post("/validate-secret")
    async def _validate_secret(body: SecretBody) -> None:
        return None

    @app.get("/boom")
    async def _boom() -> None:
        raise RuntimeError("super-secret-internal-trace")

    return TestClient(app, raise_server_exceptions=False)


client = _make_client()


def test_string_code_localized_nl_vs_en() -> None:
    nl = client.get("/string-code", headers={"Accept-Language": "nl"})
    en = client.get("/string-code", headers={"Accept-Language": "en"})
    assert nl.status_code == 404 and en.status_code == 404
    # Stable code on both; detail preserved unchanged (back-compat).
    assert nl.json()["code"] == en.json()["code"] == "PROJECT_NOT_FOUND"
    assert nl.json()["detail"] == "PROJECT_NOT_FOUND"
    # Localized message differs by language.
    assert nl.json()["message"] == "Dat project kon niet worden gevonden."
    assert en.json()["message"] == "That project could not be found."


def test_dict_detail_preserved_and_localized() -> None:
    r = client.get("/dict-code", headers={"Accept-Language": "en"})
    body = r.json()
    assert r.status_code == 409
    assert body["code"] == "DUPLICATE_FILE_CONTENT"
    # Original structured detail (with its extras) is preserved verbatim.
    assert body["detail"]["existing_file_id"] == "abc"
    assert "identical" in body["message"].lower()


def test_colon_suffix_code_strips_to_base_for_lookup() -> None:
    r = client.get("/colon-code", headers={"Accept-Language": "nl"})
    body = r.json()
    assert body["code"] == "CUSTOM_FIELD_REQUIRED"
    assert body["detail"] == "CUSTOM_FIELD_REQUIRED:field-123"  # context preserved
    assert body["message"] == "Vul alle verplichte velden in."


def test_unknown_code_falls_back_to_code() -> None:
    body = client.get("/unknown-code", headers={"Accept-Language": "en"}).json()
    assert body["code"] == "TOTALLY_UNKNOWN_CODE"
    assert body["message"] == "TOTALLY_UNKNOWN_CODE"


def test_missing_header_uses_platform_default_nl() -> None:
    # No Accept-Language and no user → platform default (nl).
    body = client.get("/string-code").json()
    assert body["message"] == "Dat project kon niet worden gevonden."


def test_region_subtag_and_quality_weights() -> None:
    # nl-NL resolves to nl; weighted list picks the highest supported tag.
    assert (
        client.get("/string-code", headers={"Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8"}).json()[
            "message"
        ]
        == "Dat project kon niet worden gevonden."
    )
    assert (
        client.get("/string-code", headers={"Accept-Language": "fr-FR,en;q=0.7,nl;q=0.6"}).json()[
            "message"
        ]
        == "That project could not be found."
    )


def test_validation_error_localized() -> None:
    nl = client.post("/validate", json={"n": "x"}, headers={"Accept-Language": "nl"})
    en = client.post("/validate", json={"n": "x"}, headers={"Accept-Language": "en"})
    assert nl.status_code == 422 and en.status_code == 422
    assert nl.json()["code"] == en.json()["code"] == "VALIDATION_ERROR"
    assert nl.json()["message"] != en.json()["message"]
    # Per-field detail list preserved for clients that map field errors.
    assert isinstance(en.json()["detail"], list)


def test_validation_error_redacts_submitted_input() -> None:
    # A body whose `password` fails validation must not echo the value back —
    # the per-field list survives for client field-mapping, but the `input`
    # echo (the only place the secret leaks) is gone.
    r = client.post("/validate-secret", json={"password": "sh0rt"})
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert isinstance(body["detail"], list) and body["detail"]
    assert all("input" not in item for item in body["detail"])
    assert "sh0rt" not in json.dumps(body)


def test_generic_exception_handler_returns_localized_500() -> None:
    en = client.get("/boom", headers={"Accept-Language": "en"})
    nl = client.get("/boom", headers={"Accept-Language": "nl"})
    assert en.status_code == 500 and nl.status_code == 500
    # Same localized envelope as every other error; never the bare Starlette text.
    assert en.json()["code"] == nl.json()["code"] == "INTERNAL_ERROR"
    assert en.json()["message"] == "Something went wrong on our end. Please try again later."
    assert nl.json()["message"] == "Er is aan onze kant iets misgegaan. Probeer het later opnieuw."
    # The internal exception text never reaches the client.
    assert "super-secret-internal-trace" not in json.dumps(en.json())


def test_attach_notice_sets_localized_success_headers() -> None:
    from urllib.parse import unquote

    from starlette.requests import Request
    from starlette.responses import Response

    from bimdossier_api.i18n.request import attach_notice

    req = Request({"type": "http", "headers": [(b"accept-language", b"nl")], "state": {}})
    resp = Response()
    attach_notice(resp, "PROJECT_CREATED", req)
    assert resp.headers["X-Message-Code"] == "PROJECT_CREATED"
    assert unquote(resp.headers["X-Message"]) == "Project aangemaakt."

    req_en = Request({"type": "http", "headers": [(b"accept-language", b"en")], "state": {}})
    resp_en = Response()
    attach_notice(resp_en, "PROJECT_CREATED", req_en)
    assert unquote(resp_en.headers["X-Message"]) == "Project created."
