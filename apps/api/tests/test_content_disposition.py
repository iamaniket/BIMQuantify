"""Unit tests for the RFC 6266-safe Content-Disposition builder (M-val).

`S3Storage.presigned_get_url` is exercised by FakeStorage in the suite, so the
header sanitization is verified here at the pure-function level instead.
"""

from __future__ import annotations

from bimdossier_api.content_disposition import safe_content_disposition


def test_plain_ascii_filename_round_trips() -> None:
    value = safe_content_disposition("report.pdf")
    assert value == "attachment; filename=\"report.pdf\"; filename*=UTF-8''report.pdf"


def test_double_quote_cannot_break_out_of_the_quoted_string() -> None:
    # The classic spoof: a `"` that closes the value early and appends a fake one.
    value = safe_content_disposition('evil".pdf')
    # Exactly the two wrapping quotes survive — the injected one is neutralized.
    assert value.count('"') == 2
    assert 'filename="evil_.pdf"' in value
    # The extended form still carries the true bytes, percent-encoded.
    assert "filename*=UTF-8''evil%22.pdf" in value


def test_crlf_cannot_inject_a_header_line() -> None:
    value = safe_content_disposition("a\r\nSet-Cookie: x=1.pdf")
    assert "\r" not in value
    assert "\n" not in value


def test_backslash_is_neutralized() -> None:
    value = safe_content_disposition("a\\b.pdf")
    assert "\\" not in value.split("filename*=")[0]  # gone from the ASCII fallback


def test_unicode_name_is_preserved_in_extended_form() -> None:
    value = safe_content_disposition("Tüv-Bericht.pdf")
    # ASCII fallback drops the non-ASCII byte; the extended form keeps it.
    assert 'filename="Tv-Bericht.pdf"' in value
    assert "filename*=UTF-8''T%C3%BCv-Bericht.pdf" in value


def test_empty_or_whitespace_filename_falls_back_to_download() -> None:
    assert safe_content_disposition("   ") == (
        "attachment; filename=\"download\"; filename*=UTF-8''download"
    )


def test_inline_disposition_is_honored() -> None:
    assert safe_content_disposition("a.png", disposition="inline").startswith("inline; ")


def test_unknown_disposition_is_coerced_to_attachment() -> None:
    assert safe_content_disposition("a.png", disposition="evil\r\n").startswith("attachment; ")
