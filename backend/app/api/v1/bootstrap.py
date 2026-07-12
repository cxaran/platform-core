from fastapi import APIRouter, Header, Request, Response, status
from sqlalchemy.exc import IntegrityError

from backend.app.api.resource_actions import api_error
from backend.app.bootstrap.security import (
    BOOTSTRAP_TOKEN_HEADER,
    bootstrap_token_required,
    require_bootstrap_token,
)
from backend.app.bootstrap.service import (
    BootstrapAdditionalRoleInput,
    BootstrapError,
    BootstrapInitializeInput,
    BootstrapRoleInput,
    BootstrapUserInput,
    MAX_ADDITIONAL_ROLES,
    get_platform_setup_status,
    initialize_platform,
)
from backend.app.core.database import SessionDep
from backend.app.core.settings import settings
from backend.app.schemas.bootstrap import (
    BootstrapCatalogRead,
    BootstrapInitializeRead,
    BootstrapInitializeRequest,
    BootstrapLimitsRead,
    BootstrapPermissionGroupRead,
    BootstrapPermissionRead,
    BootstrapStatusRead,
)
from backend.app.security.catalog import SECURITY_GROUPS
from backend.app.security.rate_limit import limit_bootstrap_initialize

router = APIRouter(prefix="/bootstrap", tags=["bootstrap"])


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


def _token_required() -> bool:
    return bootstrap_token_required(settings.bootstrap_setup_token)


def _ensure_setup_available(session: SessionDep) -> None:
    status_read = get_platform_setup_status(session, token_required=_token_required())
    if not status_read.setup_required:
        api_error(
            status.HTTP_409_CONFLICT,
            "bootstrap_completed",
            "Bootstrap ya fue completado.",
        )


@router.get("/status", response_model=BootstrapStatusRead)
def read_bootstrap_status(response: Response, session: SessionDep) -> BootstrapStatusRead:
    _no_store(response)
    return BootstrapStatusRead.model_validate(
        get_platform_setup_status(session, token_required=_token_required())
    )


@router.get("/catalog", response_model=BootstrapCatalogRead)
def read_bootstrap_catalog(
    response: Response,
    session: SessionDep,
    bootstrap_token: str | None = Header(default=None, alias=BOOTSTRAP_TOKEN_HEADER),
) -> BootstrapCatalogRead:
    _no_store(response)
    _ensure_setup_available(session)
    require_bootstrap_token(settings.bootstrap_setup_token, bootstrap_token)
    return _catalog_read()


@router.post(
    "/initialize",
    response_model=BootstrapInitializeRead,
    status_code=status.HTTP_201_CREATED,
)
def initialize_bootstrap(
    payload: BootstrapInitializeRequest,
    request: Request,
    response: Response,
    session: SessionDep,
    bootstrap_token: str | None = Header(default=None, alias=BOOTSTRAP_TOKEN_HEADER),
) -> BootstrapInitializeRead:
    _no_store(response)
    limit_bootstrap_initialize(request)
    require_bootstrap_token(settings.bootstrap_setup_token, bootstrap_token)
    try:
        initialize_platform(session, _payload_to_input(payload))
        session.commit()
    except BootstrapError as exc:
        session.rollback()
        _raise_bootstrap_error(exc)
    except IntegrityError:
        session.rollback()
        api_error(
            status.HTTP_409_CONFLICT,
            "bootstrap_conflict",
            "No se pudo completar Bootstrap.",
        )

    return BootstrapInitializeRead(setup_complete=True)


def _catalog_read() -> BootstrapCatalogRead:
    return BootstrapCatalogRead(
        permission_groups=[
            BootstrapPermissionGroupRead(
                name=group.group_name(),
                label=group.group_label(),
                permissions=[
                    BootstrapPermissionRead(
                        access=permission.permission,
                        label=permission.description or permission.permission,
                        description=permission.description,
                    )
                    for permission in group
                ],
            )
            for group in SECURITY_GROUPS
        ],
        limits=BootstrapLimitsRead(max_additional_roles=MAX_ADDITIONAL_ROLES),
    )


def _payload_to_input(payload: BootstrapInitializeRequest) -> BootstrapInitializeInput:
    return BootstrapInitializeInput(
        user=BootstrapUserInput(
            name=payload.user.name,
            last_name=payload.user.last_name,
            email=str(payload.user.email),
            password=payload.user.password,
        ),
        system_admin_role=BootstrapRoleInput(
            label=payload.system_admin_role.label,
            description=payload.system_admin_role.description,
        ),
        app_base_url=payload.app_base_url,
        public_registration_enabled=payload.public_registration_enabled,
        password_reset_enabled=payload.password_reset_enabled,
        institution_name=payload.institution_name,
        customer_session_days=payload.customer_session_days,
        staff_session_minutes=payload.staff_session_minutes,
        additional_roles=[
            BootstrapAdditionalRoleInput(
                name=role.name,
                description=role.description,
                permissions=role.permissions,
                assign_to_initial_user=role.assign_to_initial_user,
            )
            for role in payload.additional_roles
        ],
    )


def _raise_bootstrap_error(exc: BootstrapError) -> None:
    status_code = (
        status.HTTP_409_CONFLICT
        if exc.code == "bootstrap_unavailable"
        else 422
    )
    api_error(status_code, exc.code, exc.message)
