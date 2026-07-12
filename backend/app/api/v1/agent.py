from fastapi import APIRouter

from backend.app.agent.ticket import issue_connection_ticket
from backend.app.auth.auth_dependencies import CurrentUserOrm
from backend.app.core.database import SessionDep
from backend.app.schemas.agent import ConnectionTicketRead
from backend.app.services.system_settings_service import agent_ticket_ttl_effective

router = APIRouter(prefix="/agent", tags=["agent"])


@router.post("/connection-ticket", response_model=ConnectionTicketRead)
def create_connection_ticket(
    current_user: CurrentUserOrm, session: SessionDep
) -> ConnectionTicketRead:
    """Emite un ticket corto y firmado para conectar al Agent Gateway.

    Requiere sesión válida (cualquier usuario autenticado puede solicitarlo). FastAPI
    es la autoridad de datos y NO almacena credenciales del proveedor de IA: este
    ticket es el único puente FastAPI<->Gateway y solo prueba que un usuario con sesión
    vigente autorizó abrir la conexión (queda atado a su versión de sesión actual).

    TODO: en una rebanada posterior esto podría gatearse por un permiso 'agent:use'.
    """
    ticket, expires_at = issue_connection_ticket(
        current_user, ttl_seconds=agent_ticket_ttl_effective(session)
    )
    return ConnectionTicketRead(ticket=ticket, expires_at=expires_at)
