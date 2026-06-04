"""One-shot script to apply the 0002_org_certificates migration to all tenant schemas."""

import asyncio

from sqlalchemy import text

from bimstitch_api.db import get_engine


async def main() -> None:
    engine = get_engine()

    async with engine.connect() as conn:
        result = await conn.execute(
            text("SELECT schema_name FROM public.organizations")
        )
        schemas = [r[0] for r in result.fetchall()]

    for schema in schemas:
        async with engine.begin() as conn:
            await conn.execute(text(f'SET LOCAL search_path = "{schema}", public'))
            await conn.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS org_certificates ("
                    "    id UUID PRIMARY KEY, "
                    "    uploaded_by_user_id UUID REFERENCES public.users(id) ON DELETE RESTRICT, "
                    "    storage_key VARCHAR(512) NOT NULL UNIQUE, "
                    "    original_filename VARCHAR(512) NOT NULL, "
                    "    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0), "
                    "    content_type VARCHAR(255) NOT NULL, "
                    "    content_sha256 VARCHAR(64), "
                    "    certificate_type certificatetype NOT NULL, "
                    "    status certificatestatus NOT NULL DEFAULT 'pending', "
                    "    rejection_reason TEXT, "
                    "    description TEXT, "
                    "    certificate_number VARCHAR(255), "
                    "    issuer VARCHAR(255), "
                    "    subject TEXT, "
                    "    valid_from DATE, "
                    "    valid_until DATE, "
                    "    product_name VARCHAR(255), "
                    "    supplier_name VARCHAR(255), "
                    "    replaced_by_id UUID REFERENCES org_certificates(id) ON DELETE SET NULL, "
                    "    tags JSONB, "
                    "    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
                    "    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
                    "    deleted_at TIMESTAMPTZ"
                    ")"
                )
            )
            await conn.execute(
                text(
                    "ALTER TABLE certificates "
                    "ADD COLUMN IF NOT EXISTS org_certificate_id UUID "
                    "REFERENCES org_certificates(id) ON DELETE SET NULL"
                )
            )
            await conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_org_certificates_uploaded_by "
                    "ON org_certificates (uploaded_by_user_id)"
                )
            )
            await conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_org_certificates_type "
                    "ON org_certificates (certificate_type)"
                )
            )
            await conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_org_certificates_valid_until "
                    "ON org_certificates (valid_until) "
                    "WHERE valid_until IS NOT NULL AND deleted_at IS NULL"
                )
            )
            await conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_org_certificates_active "
                    "ON org_certificates (created_at) "
                    "WHERE deleted_at IS NULL"
                )
            )
            await conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_certificates_org_certificate_id "
                    "ON certificates (org_certificate_id) "
                    "WHERE org_certificate_id IS NOT NULL"
                )
            )
            print(f"Migrated {schema}")

    await engine.dispose()
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
