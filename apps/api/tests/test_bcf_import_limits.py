"""BCF import zip-bomb / oversize hardening (B3).

Structural-guard cases drive ``parse_bcf_archive`` directly with monkeypatched
caps (fast, tiny zips); the HTTP cases confirm the endpoint maps each rejection
to a localized 413.
"""

from __future__ import annotations

import io
import zipfile
from typing import TYPE_CHECKING

import pytest
from defusedxml.common import EntitiesForbidden

from bimdossier_api.bcf import parser
from bimdossier_api.bcf.parser import BcfArchiveTooLargeError, parse_bcf_archive
from bimdossier_api.config import get_settings
from tests.conftest import _auth, _create_project

if TYPE_CHECKING:
    from httpx import AsyncClient


def _zip(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buf.getvalue()


_BCF_VERSION = b'<?xml version="1.0"?><Version VersionId="2.1"/>'

# A classic XML entity-expansion bomb. defusedxml refuses the entity
# declarations outright, so it never expands — the test completing IS the proof
# it didn't hang / OOM.
_BILLION_LAUGHS = b"""<?xml version="1.0"?>
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
 <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
]>
<Markup><Topic Guid="t1"><Title>&lol4;</Title></Topic></Markup>
"""


# ---------------------------------------------------------------------------
# Structural guard — unit (no DB)
# ---------------------------------------------------------------------------


async def test_rejects_too_many_entries(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(parser, "BCF_MAX_ENTRIES", 3)
    data = _zip({f"f{i}.txt": b"x" for i in range(5)})
    with pytest.raises(BcfArchiveTooLargeError):
        parse_bcf_archive(data)


async def test_rejects_oversized_single_entry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(parser, "BCF_MAX_ENTRY_BYTES", 16)
    data = _zip({"big.bin": b"x" * 1024})
    with pytest.raises(BcfArchiveTooLargeError):
        parse_bcf_archive(data)


async def test_rejects_high_compression_ratio(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(parser, "BCF_MAX_COMPRESSION_RATIO", 5)
    # 64 KiB of zeros deflates to a few hundred bytes → ratio >> 5, while the
    # single-entry and total caps stay at their (large) defaults.
    data = _zip({"zeros.bin": b"\x00" * (64 * 1024)})
    with pytest.raises(BcfArchiveTooLargeError):
        parse_bcf_archive(data)


async def test_rejects_total_uncompressed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(parser, "BCF_MAX_TOTAL_UNCOMPRESSED_BYTES", 100)
    # Incompressible-ish payloads so the *total* cap (not the ratio cap, which is
    # checked after it) is the trigger. 5 entries x 50 bytes = 250 > 100.
    data = _zip({f"f{i}.bin": bytes(range(50)) for i in range(5)})
    with pytest.raises(BcfArchiveTooLargeError):
        parse_bcf_archive(data)


async def test_billion_laughs_xml_is_refused_not_expanded() -> None:
    data = _zip({"bcf.version": _BCF_VERSION, "t1/markup.bcf": _BILLION_LAUGHS})
    with pytest.raises(EntitiesForbidden):
        parse_bcf_archive(data)


async def test_normal_small_archive_passes_validation() -> None:
    # No structural rejection; an archive with only bcf.version yields no topics.
    result = parse_bcf_archive(_zip({"bcf.version": _BCF_VERSION}))
    assert result.version == "2.1"
    assert result.topics == []


# ---------------------------------------------------------------------------
# Endpoint mapping — HTTP (413 with BCF_ARCHIVE_TOO_LARGE)
# ---------------------------------------------------------------------------


async def test_import_oversized_upload_rejected(
    client: AsyncClient,
    org_user: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Patch the cached Settings instance the endpoint reads at request time.
    monkeypatch.setattr(get_settings(), "bcf_import_max_bytes", 100)
    project = await _create_project(client, org_user["access_token"], name="BcfLimit")
    resp = await client.post(
        f"/projects/{project['id']}/bcf-topics/import",
        files={"file": ("big.bcf", b"x" * 500, "application/zip")},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 413, resp.text
    assert resp.json()["code"] == "BCF_ARCHIVE_TOO_LARGE"


async def test_import_structural_bomb_rejected(
    client: AsyncClient,
    org_user: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(parser, "BCF_MAX_ENTRIES", 3)
    project = await _create_project(client, org_user["access_token"], name="BcfBomb")
    data = _zip({f"f{i}.txt": b"x" for i in range(5)})
    resp = await client.post(
        f"/projects/{project['id']}/bcf-topics/import",
        files={"file": ("bomb.bcf", data, "application/zip")},
        headers=_auth(org_user["access_token"]),
    )
    assert resp.status_code == 413, resp.text
    assert resp.json()["code"] == "BCF_ARCHIVE_TOO_LARGE"
