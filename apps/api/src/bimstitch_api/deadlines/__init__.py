"""Deadline computation package.

Pure-function date math in `working_days`, DB-aware recompute in `compute`.
"""

from bimstitch_api.deadlines.compute import recompute_deadlines
from bimstitch_api.deadlines.working_days import (
    add_working_days,
    compute_due_date,
    subtract_working_days,
)

__all__ = [
    "add_working_days",
    "compute_due_date",
    "recompute_deadlines",
    "subtract_working_days",
]
