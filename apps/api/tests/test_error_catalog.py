"""Error-code catalog coverage.

Every error code raised via ``HTTPException`` (or the ``_422`` helper) must have
an ``errors.<CODE>`` entry in BOTH message catalogs, so the central handler in
``i18n/http_errors.py`` localizes it instead of leaking a bare code to the user.

Extraction is AST-based (not regex) so it survives refactors and catches the
f-string (``f"CODE: {exc}"``), dict (``{"code": "CODE"}``), and conditional
(``"A" if cond else "B"``) detail forms. Codes use a ``CODE`` or ``CODE:context``
convention; the catalog key is always the part before the first colon.
"""

from __future__ import annotations

import ast
from pathlib import Path

from bimstitch_api.i18n.messages import en_messages, nl_messages

SRC = Path(__file__).resolve().parents[1] / "src" / "bimstitch_api"


def _code(value: str) -> str:
    return value.split(":", 1)[0].strip()


def _codes_from_detail(node: ast.AST) -> set[str]:
    """Pull the catalog code(s) out of a detail expression node."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return {_code(node.value)}
    if isinstance(node, ast.JoinedStr):  # f-string — take the leading literal
        first = node.values[0] if node.values else None
        if isinstance(first, ast.Constant) and isinstance(first.value, str):
            return {_code(first.value)}
        return set()
    if isinstance(node, ast.Dict):
        out: set[str] = set()
        for key, val in zip(node.keys, node.values, strict=True):
            if (
                isinstance(key, ast.Constant)
                and key.value == "code"
                and isinstance(val, ast.Constant)
                and isinstance(val.value, str)
            ):
                out.add(_code(val.value))
        return out
    if isinstance(node, ast.IfExp):  # "A" if cond else "B"
        return _codes_from_detail(node.body) | _codes_from_detail(node.orelse)
    return set()


def _raised_codes() -> dict[str, set[str]]:
    """Map each raised error code → set of source files that raise it."""
    codes: dict[str, set[str]] = {}
    for path in SRC.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", None)
            found: set[str] = set()
            if name == "HTTPException":
                for kw in node.keywords:
                    if kw.arg == "detail":
                        found |= _codes_from_detail(kw.value)
            elif name == "_422" and node.args:
                found |= _codes_from_detail(node.args[0])
            for code in found:
                if code and code[0].isupper():
                    codes.setdefault(code, set()).add(path.name)
    return codes


def test_every_raised_error_code_has_catalog_entry() -> None:
    missing: dict[str, set[str]] = {}
    for code, files in _raised_codes().items():
        if f"errors.{code}" not in en_messages or f"errors.{code}" not in nl_messages:
            missing[code] = files
    listing = "\n".join(
        f"  {code}  ({', '.join(sorted(files))})" for code, files in sorted(missing.items())
    )
    assert not missing, (
        "Uncatalogued error codes — add errors.<CODE> to BOTH "
        "i18n/messages/en.py and nl.py:\n" + listing
    )
