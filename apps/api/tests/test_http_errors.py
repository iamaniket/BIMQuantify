"""Behavior tests for the localized error envelope and Accept-Language
resolution. Self-contained — builds a tiny app that raises the same way the
real routers do, so it needs no DB or fixtures.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from bimstitch_api.i18n.http_errors import (
    http_exception_handler,
    validation_exception_handler,
)


def _make_client() -> TestClient:
    app = FastAPI()
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)

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
    assert client.get(
        "/string-code", headers={"Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8"}
    ).json()["message"] == "Dat project kon niet worden gevonden."
    assert client.get(
        "/string-code", headers={"Accept-Language": "fr-FR,en;q=0.7,nl;q=0.6"}
    ).json()["message"] == "That project could not be found."


def test_validation_error_localized() -> None:
    nl = client.post("/validate", json={"n": "x"}, headers={"Accept-Language": "nl"})
    en = client.post("/validate", json={"n": "x"}, headers={"Accept-Language": "en"})
    assert nl.status_code == 422 and en.status_code == 422
    assert nl.json()["code"] == en.json()["code"] == "VALIDATION_ERROR"
    assert nl.json()["message"] != en.json()["message"]
    # Per-field detail list preserved for clients that map field errors.
    assert isinstance(en.json()["detail"], list)


def test_attach_notice_sets_localized_success_headers() -> None:
    from urllib.parse import unquote

    from starlette.requests import Request
    from starlette.responses import Response

    from bimstitch_api.i18n.request import attach_notice

    req = Request({"type": "http", "headers": [(b"accept-language", b"nl")], "state": {}})
    resp = Response()
    attach_notice(resp, "PROJECT_CREATED", req)
    assert resp.headers["X-Message-Code"] == "PROJECT_CREATED"
    assert unquote(resp.headers["X-Message"]) == "Project aangemaakt."

    req_en = Request({"type": "http", "headers": [(b"accept-language", b"en")], "state": {}})
    resp_en = Response()
    attach_notice(resp_en, "PROJECT_CREATED", req_en)
    assert unquote(resp_en.headers["X-Message"]) == "Project created."
