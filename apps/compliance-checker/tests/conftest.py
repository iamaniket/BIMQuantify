from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from compliance_checker.rules.loader import RuleIndex

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def sample_metadata() -> dict[str, Any]:
    return json.loads((FIXTURES_DIR / "sample_metadata.json").read_text())


@pytest.fixture
def sample_metadata_tall(sample_metadata: dict[str, Any]) -> dict[str, Any]:
    data = copy.deepcopy(sample_metadata)
    data["bbox"]["max"] = [12000, 8000, 25000]
    return data


@pytest.fixture
def sample_properties() -> dict[str, Any]:
    return json.loads((FIXTURES_DIR / "sample_properties.json").read_text())


@pytest.fixture
def rule_index() -> RuleIndex:
    idx = RuleIndex()
    rules_dir = Path(__file__).parent.parent / "rules"
    idx.load(rules_dir)
    return idx
