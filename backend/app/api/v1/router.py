from fastapi import APIRouter

from backend.app.api.v1.agent import router as agent_router
from backend.app.api.v1.agent_internal import router as agent_internal_router
from backend.app.api.v1.ai_providers import router as ai_providers_router
from backend.app.api.v1.audit_events import router as audit_events_router
from backend.app.api.v1.auth import router as auth_router
from backend.app.api.v1.backups import router as backups_router
from backend.app.api.v1.bootstrap import router as bootstrap_router
from backend.app.api.v1.branding import router as branding_router
from backend.app.api.v1.notifications import router as notifications_router
from backend.app.api.v1.permissions import router as permissions_router
from backend.app.api.v1.resources import router as resources_router
from backend.app.api.v1.roles import router as roles_router
from backend.app.api.v1.system_settings import router as system_settings_router
from backend.app.api.v1.users import router as users_router
from backend.app.api.v1.users_admin import router as users_admin_router


router = APIRouter(prefix="/v1")
router.include_router(agent_router)
router.include_router(agent_internal_router)
router.include_router(ai_providers_router)
router.include_router(audit_events_router)
router.include_router(auth_router)
router.include_router(backups_router)
router.include_router(bootstrap_router)
router.include_router(branding_router)
router.include_router(notifications_router)
router.include_router(permissions_router)
router.include_router(resources_router)
router.include_router(roles_router)
router.include_router(system_settings_router)
router.include_router(users_router)
router.include_router(users_admin_router)
