"""Email template for the free-tier idle-container deletion warning.

Sent once per owner per sweep cycle by the idle reaper's warn pass
(``pooled_reconcile.sweep_idle_pooled_containers``) when one or more of their
containers has been idle past ``FREE_MODEL_IDLE_WARNING_DAYS`` but not yet past
the deletion TTL. Single-locale via the recipient's ``User.locale`` (the owner
is a known account — the ``resolve_user_locale`` policy), unlike the bilingual
deadline emails which fan out to mixed-locale project members.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from bimdossier_api.email.transport import get_email_transport
from bimdossier_api.i18n import t

if TYPE_CHECKING:
    from bimdossier_api.i18n import Locale


async def send_idle_containers_warning_email(
    *,
    to: str,
    full_name: str | None,
    locale: Locale,
    container_names: str,
    days_idle: int,
    days_until_delete: int,
) -> None:
    """One-time "your idle models will be deleted" warning (single-locale)."""
    name = full_name or to
    body = t(
        "free.idle_warning_email.body",
        locale,
        name=name,
        container_names=container_names,
        days_idle=days_idle,
        days_until_delete=days_until_delete,
    )
    subject = t(
        "free.idle_warning_email.subject",
        locale,
        days_until_delete=days_until_delete,
    )
    await get_email_transport().send(to=to, subject=subject, body=body)
