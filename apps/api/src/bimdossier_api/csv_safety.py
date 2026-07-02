"""CSV formula/DDE injection neutralization — the mandatory choke-point for any
CSV cell derived from user-controlled data.

A spreadsheet application (Excel, Google Sheets, LibreOffice) auto-evaluates a
cell whose *text* begins with ``=``, ``+``, ``-``, ``@`` (or a leading tab / CR),
so an attacker who gets ``=HYPERLINK(...)`` / ``=cmd|...`` / ``+WEBSERVICE(...)``
into an exported field can run a formula (data exfiltration, DDE command exec) on
the machine of whoever opens the download — typically a super-admin reviewing
leads, or a project member opening a findings export.

Wrapping the value in quotes is NOT enough: the spreadsheet strips the surrounding
quotes and still sees the leading ``=``. Prefixing the value with a single quote
makes the app treat the whole cell as literal text. Numbers, dates, and ordinary
text are left untouched.

Apply at every ``csv.writer``/``csv.DictWriter`` data-row site (never the header —
column names are fixed constants):

    writer.writerow(csv_safe_row([str(r.id), r.name, r.notes or ""]))
    writer.writerow(csv_safe_mapping(row_dict))
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

# The leading characters a spreadsheet treats as the start of a formula/command.
# Tab and CR are included because some importers strip them and re-expose the
# next character as the cell start.
_DANGEROUS_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def csv_safe_value(value: Any) -> str:
    """Return ``value`` coerced to text, prefixed with a single quote when it
    begins with a formula/command trigger character. No-op otherwise."""
    text = "" if value is None else str(value)
    if text.startswith(_DANGEROUS_PREFIXES):
        return "'" + text
    return text


def csv_safe_row(row: Sequence[Any]) -> list[str]:
    """Neutralize every cell of a positional (``csv.writer``) row."""
    return [csv_safe_value(v) for v in row]


def csv_safe_mapping(row: Mapping[str, Any]) -> dict[str, str]:
    """Neutralize every value of a ``csv.DictWriter`` row (keys are fieldnames,
    left as-is)."""
    return {key: csv_safe_value(value) for key, value in row.items()}
