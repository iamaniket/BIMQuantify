from uuid import UUID

from fastapi import Depends, Request
from fastapi_users import FastAPIUsers

from bimdossier_api.auth.backend import auth_backend
from bimdossier_api.auth.manager import get_user_manager
from bimdossier_api.models.user import User

fastapi_users = FastAPIUsers[User, UUID](get_user_manager, [auth_backend])

# Raw FastAPI-Users dependencies. We wrap each one below so the resolved user's
# locale is stashed on request.state — that lets error responses raised later in
# the request fall back to the user's preferred language when no Accept-Language
# header was sent. See i18n/request.py::resolve_request_locale.
_current_active_user = fastapi_users.current_user(active=True)
_current_verified_user = fastapi_users.current_user(active=True, verified=True)
_current_superuser = fastapi_users.current_user(active=True, verified=True, superuser=True)


def _stash_user_locale(request: Request, user: User) -> None:
    locale = getattr(user, "locale", None)
    if locale:
        request.state.user_locale = locale


async def current_active_user(
    request: Request, user: User = Depends(_current_active_user)
) -> User:
    _stash_user_locale(request, user)
    return user


async def current_verified_user(
    request: Request, user: User = Depends(_current_verified_user)
) -> User:
    _stash_user_locale(request, user)
    return user


async def current_superuser(
    request: Request, user: User = Depends(_current_superuser)
) -> User:
    _stash_user_locale(request, user)
    return user
