// Puerto de validación de la SESIÓN DEL BACKEND (FastAPI) para un turno del agente.
//
// El gateway NO es la autoridad de la sesión de la organización: no tiene el secreto de firma de los
// JWT del backend (por eso existe el connection-ticket con su propio secreto). Para saber si
// la sesión del usuario SIGUE VIVA en el momento de correr un turno, el gateway reenvía la
// cookie de sesión del backend a FastAPI y deja que ÉL la valide (firma, versión de sesión
// ``User.token``, expiración, usuario activo). Devuelve la identidad si está viva, o ``null``
// si no lo está (expirada, rotada por logout/cambio de rol, secreto de firma cambiado).
//
// Esto cierra el hueco por el que un turno del modelo corría aunque la sesión del backend ya
// estuviera muerta: el modelo queda ATADO a una sesión vigente, igual que las tools.

export interface BackendSessionIdentity {
  userId: string;
}

export interface BackendSessionValidatorPort {
  /**
   * Valida la cookie de sesión del backend. Devuelve la identidad del usuario si la sesión
   * sigue viva, o ``null`` si no es válida (incluido cookie ausente o backend inalcanzable:
   * fail-closed, nunca se autoriza el turno ante la duda).
   */
  validate(sessionCookieValue: string | null): Promise<BackendSessionIdentity | null>;
}
