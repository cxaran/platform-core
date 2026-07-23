from typing import Annotated, Any

from fastapi import Depends, HTTPException, status

from backend.app.auth.auth_dependencies import CurrentUser



class SecurityControl:
    """Clase que representa un permiso del sistema con dominio."""

    def __init__(
        self,
        access: str,
        description: str | None = None,
    ):
        self.access = access
        self.description = description

    def __repr__(self) -> str:
        return f"SecurityControl({self.access})"

    def check(
        self,
        current_user: CurrentUser,
    ) -> bool:
        return current_user.access_control(self.access)

    def _requiere(
        self,
        current_user: CurrentUser,
    ) -> bool:
        if not self.check(current_user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="No disponible"
            )
        return True

    @property
    def requiere(self) -> Any:
        return Annotated[bool, Depends(self._requiere)]

    
