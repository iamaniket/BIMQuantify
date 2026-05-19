"""extend notificationeventtype enum with deadline/finding/invitation values

Wkb MVP backlog #30: ship the additional event types up front so the
notification feed can render filtering chrome ahead of the producers that
will emit them (deadline tracker #28/#29, findings #25/#26, invitations
#8/#11). Purely additive: existing event_type rows continue to validate.

Postgres `ALTER TYPE ... ADD VALUE` cannot run inside a transaction in
older versions, so we use the standard idempotent rename-recreate pattern
to be safe on every supported deployment.

Revision ID: h2i3j4k5l6m7
Revises: g1h2i3j4k5l6
Create Date: 2026-05-18 21:30:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "h2i3j4k5l6m7"
down_revision: str | None = "g1h2i3j4k5l6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_NEW_VALUES = (
    "deadline_upcoming",
    "deadline_missed",
    "finding_created",
    "finding_resolved",
    "invitation_sent",
    "invitation_accepted",
)


def upgrade() -> None:
    # `IF NOT EXISTS` keeps the migration idempotent if a re-run happens
    # (Postgres 9.6+). Each ADD VALUE is its own statement because Postgres
    # doesn't allow them inside a multi-statement transaction block on
    # older versions; alembic runs each op.execute in its own statement.
    for value in _NEW_VALUES:
        op.execute(
            f"ALTER TYPE notificationeventtype ADD VALUE IF NOT EXISTS '{value}';"
        )


def downgrade() -> None:
    # Postgres has no built-in DROP VALUE for enums. Recreate the enum from
    # scratch with only the original values; existing rows that already use
    # any of the new values would block the swap, which is the right
    # behaviour — refuse to downgrade if production data already depends
    # on a value we're trying to remove.
    op.execute(
        """
        DO $$
        DECLARE
            offending_count integer;
        BEGIN
            SELECT count(*) INTO offending_count
            FROM notifications
            WHERE event_type::text IN (
                'deadline_upcoming', 'deadline_missed',
                'finding_created', 'finding_resolved',
                'invitation_sent', 'invitation_accepted'
            );
            IF offending_count > 0 THEN
                RAISE EXCEPTION
                  'Cannot downgrade: % notifications use new event_type values',
                  offending_count;
            END IF;
        END$$;
        """
    )
    op.execute("ALTER TYPE notificationeventtype RENAME TO notificationeventtype_old;")
    op.execute(
        """
        CREATE TYPE notificationeventtype AS ENUM (
            'job_started', 'job_succeeded', 'job_failed', 'job_progress'
        );
        """
    )
    op.execute(
        """
        ALTER TABLE notifications
            ALTER COLUMN event_type TYPE notificationeventtype
            USING event_type::text::notificationeventtype;
        """
    )
    op.execute("DROP TYPE notificationeventtype_old;")
