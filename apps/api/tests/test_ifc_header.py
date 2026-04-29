"""Pure-function tests for the STEP/IFC header parser.

No DB, no I/O — fast unit tests."""

from bimstitch_api.ifc.header import HeaderRejection, parse_ifc_header
from bimstitch_api.models.project_file import IfcSchema


def _wrap(schema_token: str) -> bytes:
    return (
        b"ISO-10303-21;\nHEADER;\n"
        b"FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');\n"
        b"FILE_NAME('test.ifc','2026-01-01T00:00:00','','','','','');\n"
        + schema_token.encode("ascii")
        + b"\nENDSEC;\nDATA;\n"
    )


def test_parses_ifc4() -> None:
    result = parse_ifc_header(_wrap("FILE_SCHEMA(('IFC4'));"))
    assert result.schema is IfcSchema.ifc4
    assert result.rejection is None


def test_parses_ifc2x3() -> None:
    result = parse_ifc_header(_wrap("FILE_SCHEMA(('IFC2X3'));"))
    assert result.schema is IfcSchema.ifc2x3
    assert result.rejection is None


def test_parses_ifc4x3() -> None:
    result = parse_ifc_header(_wrap("FILE_SCHEMA(('IFC4X3'));"))
    assert result.schema is IfcSchema.ifc4x3
    assert result.rejection is None


def test_rejects_ifc4x1() -> None:
    # IFC4X1 is not in the supported schema allow-list (only IFC2X3, IFC4, IFC4X3).
    result = parse_ifc_header(_wrap("FILE_SCHEMA(('IFC4X1'));"))
    assert result.schema is IfcSchema.unknown
    assert result.rejection is HeaderRejection.unknown_schema


def test_accepts_double_quotes_around_schema() -> None:
    result = parse_ifc_header(_wrap('FILE_SCHEMA(("IFC4"));'))
    assert result.schema is IfcSchema.ifc4


def test_tolerates_whitespace_in_file_schema() -> None:
    result = parse_ifc_header(_wrap("FILE_SCHEMA  (  (  'IFC4'  )  );"))
    assert result.schema is IfcSchema.ifc4


def test_lowercase_schema_is_normalised() -> None:
    result = parse_ifc_header(_wrap("FILE_SCHEMA(('ifc4'));"))
    assert result.schema is IfcSchema.ifc4


def test_empty_bytes_rejected_as_not_step() -> None:
    result = parse_ifc_header(b"")
    assert result.schema is None
    assert result.rejection is HeaderRejection.not_step


def test_random_text_rejected_as_not_step() -> None:
    result = parse_ifc_header(b"Hello world this is not an IFC file at all\n")
    assert result.schema is None
    assert result.rejection is HeaderRejection.not_step


def test_iso_magic_but_no_file_schema_returns_no_schema() -> None:
    result = parse_ifc_header(b"ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n")
    assert result.schema is None
    assert result.rejection is HeaderRejection.no_schema


def test_unknown_schema_returns_unknown_with_rejection() -> None:
    result = parse_ifc_header(_wrap("FILE_SCHEMA(('IFC9X9'));"))
    assert result.schema is IfcSchema.unknown
    assert result.rejection is HeaderRejection.unknown_schema


def test_leading_whitespace_tolerated() -> None:
    result = parse_ifc_header(b"   \n  " + _wrap("FILE_SCHEMA(('IFC4'));"))
    assert result.schema is IfcSchema.ifc4


def test_utf8_bom_tolerated() -> None:
    result = parse_ifc_header(b"\xef\xbb\xbf" + _wrap("FILE_SCHEMA(('IFC4'));"))
    assert result.schema is IfcSchema.ifc4


def test_crlf_line_endings_tolerated() -> None:
    blob = (
        b"ISO-10303-21;\r\nHEADER;\r\n"
        b"FILE_DESCRIPTION(('x'),'2;1');\r\n"
        b"FILE_SCHEMA(('IFC4'));\r\nENDSEC;\r\n"
    )
    result = parse_ifc_header(blob)
    assert result.schema is IfcSchema.ifc4
