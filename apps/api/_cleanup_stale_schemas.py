"""One-off: drop leftover per-tenant org_* schemas in the test DB.

A prior aborted pytest run can leave an org_<hex> schema behind whose FKs
reference public.users, which then blocks DROP TABLE public.users during the
next session's drop_all. This clears them.
"""

import asyncio

import asyncpg


async def main() -> None:
    conn = await asyncpg.connect(
        "postgresql://bim:bim@localhost:5434/bimstitch_test"
    )
    try:
        rows = await conn.fetch(
            "SELECT schema_name FROM information_schema.schemata "
            "WHERE schema_name LIKE 'org_%'"
        )
        names = [r["schema_name"] for r in rows]
        print(f"Found {len(names)} org_* schema(s): {names}")
        for name in names:
            await conn.execute(f'DROP SCHEMA IF EXISTS "{name}" CASCADE')
            print(f"  dropped {name}")
    finally:
        await conn.close()


asyncio.run(main())
