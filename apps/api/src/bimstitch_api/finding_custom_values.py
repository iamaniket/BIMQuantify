"""Validate a finding's custom-field answers against its template.

Pure, DB-free, unit-testable. Given a `FindingTemplate` (or None) and the raw
answer map a client submitted, returns the snapshot stored on
`Finding.custom_values`:

    {field_id: {"label": str, "type": str, "value": Any}}

The label+type snapshot is deliberate: it lets the finding render correctly even
after the template's fields change or the template is deleted. Raises
`HTTPException(422, detail=<SCREAMING_SNAKE>)` on any violation so the portal can
map the code to a localized message.
"""

from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING, Any

from fastapi import HTTPException, status

from bimstitch_api.schemas.finding_template import FieldDef, FindingFieldType

if TYPE_CHECKING:
    from bimstitch_api.models.finding_template import FindingTemplate

_MAX_TEXT = 4000


def _422(code: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=code)


def _is_blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def _coerce(field: FieldDef, value: Any) -> Any:
    """Validate + normalize a single non-blank answer for its field type."""
    if field.type in (FindingFieldType.text, FindingFieldType.textarea):
        if not isinstance(value, str):
            raise _422(f"CUSTOM_FIELD_BAD_TEXT:{field.id}")
        text = value.strip()
        if len(text) > _MAX_TEXT:
            raise _422(f"CUSTOM_FIELD_TOO_LONG:{field.id}")
        return text

    if field.type is FindingFieldType.number:
        try:
            num = float(value)
        except (TypeError, ValueError):
            raise _422(f"CUSTOM_FIELD_NOT_A_NUMBER:{field.id}") from None
        if field.min is not None and num < field.min:
            raise _422(f"CUSTOM_FIELD_NUMBER_OUT_OF_RANGE:{field.id}")
        if field.max is not None and num > field.max:
            raise _422(f"CUSTOM_FIELD_NUMBER_OUT_OF_RANGE:{field.id}")
        return int(num) if num.is_integer() else num

    if field.type is FindingFieldType.date:
        if not isinstance(value, str):
            raise _422(f"CUSTOM_FIELD_BAD_DATE:{field.id}")
        try:
            date.fromisoformat(value)
        except ValueError:
            raise _422(f"CUSTOM_FIELD_BAD_DATE:{field.id}") from None
        return value

    if field.type is FindingFieldType.select:
        options = field.options or []
        if value not in options:
            raise _422(f"CUSTOM_FIELD_BAD_OPTION:{field.id}")
        return value

    # checkbox handled separately (never blank); shouldn't reach here.
    raise _422(f"CUSTOM_FIELD_UNKNOWN_TYPE:{field.id}")


def build_custom_values(
    template: FindingTemplate | None,
    raw: dict[str, Any] | None,
) -> dict[str, dict[str, Any]] | None:
    raw = raw or {}

    if template is None:
        if raw:
            raise _422("CUSTOM_VALUES_WITHOUT_TEMPLATE")
        return None

    fields = [FieldDef.model_validate(f) for f in (template.fields or [])]
    field_by_id = {f.id: f for f in fields}

    unknown = set(raw) - set(field_by_id)
    if unknown:
        raise _422(f"UNKNOWN_CUSTOM_FIELD:{','.join(sorted(unknown))}")

    snapshot: dict[str, dict[str, Any]] = {}
    for field in fields:
        raw_value = raw.get(field.id)

        if field.type is FindingFieldType.checkbox:
            # A checkbox always has a value; "required" means it must be checked.
            checked = bool(raw_value)
            if field.required and not checked:
                raise _422(f"CUSTOM_FIELD_REQUIRED:{field.id}")
            snapshot[field.id] = {
                "label": field.label,
                "type": field.type.value,
                "value": checked,
            }
            continue

        if _is_blank(raw_value):
            if field.required:
                raise _422(f"CUSTOM_FIELD_REQUIRED:{field.id}")
            continue  # optional + blank → not stored

        snapshot[field.id] = {
            "label": field.label,
            "type": field.type.value,
            "value": _coerce(field, raw_value),
        }

    return snapshot or None
