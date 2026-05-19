"""DEPRECATED — superseded by `bimstitch_api.seed`, which now seeds demo
projects directly into the demo orgs' tenant schemas as part of the same
saga that creates the orgs.

Kept as a stub so any leftover docs/scripts referencing it don't error;
running it is a no-op.
"""

from __future__ import annotations

import asyncio


async def seed_projects() -> None:
    print(
        "seed_projects is deprecated — `bimstitch_api.seed` now provisions "
        "demo orgs with projects in one step."
    )


if __name__ == "__main__":
    asyncio.run(seed_projects())
