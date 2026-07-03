// Generado automáticamente por scripts/generate-openapi.mjs. No editar manualmente.

export interface paths {
    "/api/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Health */
        get: operations["health_api_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Readiness */
        get: operations["readiness_api_ready_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Audit Events */
        get: operations["list_audit_events_api_v1_audit_events_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit-events/{event_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Audit Event */
        get: operations["get_audit_event_api_v1_audit_events__event_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/policy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read Auth Policy
         * @description Política pública de auth. El frontend la consume; no infiere de settings.
         *
         *     El registro público es la política EFECTIVA: lo persistido en system_settings
         *     (editable por administradores) AND el candado del despliegue.
         */
        get: operations["read_auth_policy_api_v1_auth_policy_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read Current User */
        get: operations["read_current_user_api_v1_auth_me_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Login */
        post: operations["login_api_v1_auth_login_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/login/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Verify Login
         * @description Canjea el secreto del reto (código o token del enlace) por la sesión.
         *
         *     Exige la cookie del reto del MISMO navegador que inició el login: un enlace
         *     reenviado a otro dispositivo no crea sesión ahí. Consumo único y tope de
         *     intentos por reto; el error es genérico (no distingue causa).
         */
        post: operations["verify_login_api_v1_auth_login_verify_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/google/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Google Login Start
         * @description Arranca el OAuth con Google: 302 a la pantalla de consentimiento.
         *
         *     404 genérico con la función deshabilitada (no revela si existe la política);
         *     el state viaja hasheado en Redis con consumo único y TTL corto.
         */
        get: operations["google_login_start_api_v1_auth_google_start_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/google/callback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Google Login Callback
         * @description Aterrizaje del OAuth: valida state+nonce+id_token y resuelve la cuenta.
         *
         *     Éxito → cookie de sesión y 302 al inicio (SIN pasar por la verificación de
         *     login por correo: Google ya autenticó). Cualquier fallo → 302 a /login con
         *     un marcador genérico; la causa real queda sólo en los logs.
         */
        get: operations["google_login_callback_api_v1_auth_google_callback_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Logout
         * @description Cierra la sesión actual borrando la cookie httponly.
         *
         *     Requiere sesión válida; no rota ``User.token`` (no es un cierre de sesión en
         *     todos los dispositivos, solo el actual).
         */
        post: operations["logout_api_v1_auth_logout_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/register/request": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Request Registration */
        post: operations["request_registration_api_v1_auth_register_request_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/register/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Complete Registration */
        post: operations["complete_registration_api_v1_auth_register_complete_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/unlock": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Unlock Account */
        post: operations["unlock_account_api_v1_auth_unlock_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/password/forgot": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Request Password Reset */
        post: operations["request_password_reset_api_v1_auth_password_forgot_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/password/reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Complete Password Reset */
        post: operations["complete_password_reset_api_v1_auth_password_reset_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/backup-settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Backup Settings */
        get: operations["list_backup_settings_api_v1_backup_settings_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/backup-settings/{item_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Backup Settings Detail */
        get: operations["get_backup_settings_detail_api_v1_backup_settings__item_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update Backup Settings
         * @description Edita la configuración. Reglas de fondo: zona IANA real, recipient de age
         *     UTILIZABLE (se valida invocando age), y ``enabled=true`` sólo con la
         *     configuración completa. Cambios de horario recalculan ``next_run_at``.
         */
        patch: operations["update_backup_settings_api_v1_backup_settings__item_id__patch"];
        trace?: never;
    };
    "/api/v1/backup-settings/{item_id}/generate-encryption-key": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Generate Encryption Key
         * @description Genera el par de claves age EN EL SISTEMA y activa el cifrado. La identidad
         *     privada viaja por CORREO al administrador (y queda guardada cifrada para
         *     reenviarse en cada cambio); la API nunca la devuelve.
         */
        post: operations["generate_encryption_key_api_v1_backup_settings__item_id__generate_encryption_key_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/backup-settings/{item_id}/connect-drive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Connect Drive */
        post: operations["connect_drive_api_v1_backup_settings__item_id__connect_drive_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/backups/google-drive/callback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Google Drive Callback
         * @description Callback OAuth de Google. Redirige a la pantalla de respaldos del frontend con
         *     un resultado NO sensible (?drive=connected|error).
         */
        get: operations["google_drive_callback_api_v1_backups_google_drive_callback_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/backup-settings/{item_id}/disconnect-drive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Disconnect Drive */
        post: operations["disconnect_drive_api_v1_backup_settings__item_id__disconnect_drive_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/backup-settings/{item_id}/run-now": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Run Backup Now
         * @description Encola un respaldo manual y despierta el tick (si el broker no está arriba, el
         *     tick del siguiente minuto lo toma igual: la cola es la verdad).
         */
        post: operations["run_backup_now_api_v1_backup_settings__item_id__run_now_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/backup-runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Backup Runs */
        get: operations["list_backup_runs_api_v1_backup_runs_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/backup-runs/{item_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Backup Run */
        get: operations["get_backup_run_api_v1_backup_runs__item_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/backups/drive-files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Drive Backup Files
         * @description Archivos REALES de la carpeta de respaldos en la cuenta de Drive conectada
         *     (nombre, tipo, fecha y tamaño; más reciente primero).
         */
        get: operations["list_drive_backup_files_api_v1_backups_drive_files_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/backups/drive-files/{file_id}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download Drive Backup File
         * @description Descarga en STREAMING de un archivo de la carpeta de respaldos. Sólo sirve
         *     archivos que pertenezcan a la carpeta configurada (aunque el scope drive.file ya
         *     acota a archivos de la app, se valida la pertenencia explícitamente).
         */
        get: operations["download_drive_backup_file_api_v1_backups_drive_files__file_id__download_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/bootstrap/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read Bootstrap Status */
        get: operations["read_bootstrap_status_api_v1_bootstrap_status_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/bootstrap/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read Bootstrap Catalog */
        get: operations["read_bootstrap_catalog_api_v1_bootstrap_catalog_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/bootstrap/initialize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Initialize Bootstrap */
        post: operations["initialize_bootstrap_api_v1_bootstrap_initialize_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/permissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Permissions */
        get: operations["list_permissions_api_v1_permissions_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/resources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Resources */
        get: operations["list_resources_api_v1_resources_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/resources/{resource_name}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Resource Capability */
        get: operations["get_resource_capability_api_v1_resources__resource_name__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Roles */
        get: operations["list_roles_api_v1_roles_get"];
        put?: never;
        /** Create Role */
        post: operations["create_role_api_v1_roles_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/roles/{role_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Role */
        get: operations["get_role_api_v1_roles__role_id__get"];
        put?: never;
        post?: never;
        /** Delete Role */
        delete: operations["delete_role_api_v1_roles__role_id__delete"];
        options?: never;
        head?: never;
        /** Update Role */
        patch: operations["update_role_api_v1_roles__role_id__patch"];
        trace?: never;
    };
    "/api/v1/roles/{role_id}/permissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Role Permissions
         * @description Selección actual de permisos del rol (lectura para el editor relacional).
         */
        get: operations["get_role_permissions_api_v1_roles__role_id__permissions_get"];
        /** Replace Role Permissions */
        put: operations["replace_role_permissions_api_v1_roles__role_id__permissions_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/system-settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List System Settings */
        get: operations["list_system_settings_api_v1_system_settings_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/system-settings/setup-checklist": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Setup Checklist
         * @description Checklist de puesta en marcha DERIVADO del estado real de la configuración.
         */
        get: operations["get_setup_checklist_api_v1_system_settings_setup_checklist_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/system-settings/setup-checklist/dismiss": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Dismiss Setup Checklist
         * @description Descarta el banner del checklist (el checklist sigue disponible a demanda).
         */
        post: operations["dismiss_setup_checklist_api_v1_system_settings_setup_checklist_dismiss_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/domain-challenge/{nonce}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Domain Challenge
         * @description Reto PÚBLICO de verificación de dominio: responde un HMAC del nonce con la
         *     clave de la instalación. El verificador (verify-domain) llama a este endpoint A
         *     TRAVÉS del dominio propuesto: si la respuesta coincide, ese dominio sirve ESTA
         *     instalación. Sin estado, sin auth, sin efectos.
         */
        get: operations["domain_challenge_api_v1_domain_challenge__nonce__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/system-settings/{item_id}/verify-domain": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Verify Domain
         * @description Verifica y guarda el dominio base de la instalación.
         *
         *     Deriva el candidato del header Origin si no se envía; lo normaliza (solo
         *     esquema+host+puerto) y hace la prueba REAL: pedir el domain-challenge A TRAVÉS
         *     de ese dominio y comparar el HMAC. Si pasa, se persiste (app_base_url +
         *     verified_at), se AÑADE a los orígenes confiables en runtime (nunca reemplaza
         *     los del entorno) y habilita los redirect URIs derivados (p. ej. Google Drive).
         */
        post: operations["verify_domain_api_v1_system_settings__item_id__verify_domain_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/system-settings/{item_id}/send-test-email": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Send Test Email
         * @description Verifica el transporte configurado enviando un correo real y PERSISTE el
         *     desenlace (email_last_test_*): el checklist marca el correo como verificado
         *     solo tras un test exitoso.
         */
        post: operations["send_test_email_api_v1_system_settings__item_id__send_test_email_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/system-settings/{item_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get System Settings Detail */
        get: operations["get_system_settings_detail_api_v1_system_settings__item_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update System Settings */
        patch: operations["update_system_settings_api_v1_system_settings__item_id__patch"];
        trace?: never;
    };
    "/api/v1/users/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read Profile */
        get: operations["read_profile_api_v1_users_me_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update Profile */
        patch: operations["update_profile_api_v1_users_me_patch"];
        trace?: never;
    };
    "/api/v1/users/me/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Change Password */
        post: operations["change_password_api_v1_users_me_password_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Users */
        get: operations["list_users_api_v1_users_get"];
        put?: never;
        /** Create User */
        post: operations["create_user_api_v1_users_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/{user_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get User */
        get: operations["get_user_api_v1_users__user_id__get"];
        put?: never;
        post?: never;
        /** Delete User */
        delete: operations["delete_user_api_v1_users__user_id__delete"];
        options?: never;
        head?: never;
        /** Update User */
        patch: operations["update_user_api_v1_users__user_id__patch"];
        trace?: never;
    };
    "/api/v1/users/{user_id}/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List User Roles */
        get: operations["list_user_roles_api_v1_users__user_id__roles_get"];
        /** Replace User Roles */
        put: operations["replace_user_roles_api_v1_users__user_id__roles_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/{user_id}/revoke-sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Revoke User Sessions */
        post: operations["revoke_user_sessions_api_v1_users__user_id__revoke_sessions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /**
         * ActionCondition
         * @description Condición de estado de una acción: conjunción (``all``) de predicados.
         *
         *     Sólo se soporta ``all`` (todos los predicados deben cumplirse). El permiso es una
         *     propiedad aparte (``permission`` en el registro) y nunca se expresa aquí. El backend
         *     sigue siendo la autoridad final: si el frontend no puede evaluar la condición, debe
         *     comportarse de forma conservadora.
         */
        ActionCondition: {
            /** All */
            all: components["schemas"]["ActionConditionPredicate"][];
        };
        /**
         * ActionConditionOperator
         * @description Operadores del DSL serializable de condiciones (``visible_when``/``enabled_when``).
         *
         *     Es un contrato de datos, no un lenguaje evaluable: nunca se publican expresiones,
         *     JavaScript, Python ni lambdas.
         * @enum {string}
         */
        ActionConditionOperator: "eq" | "neq" | "in" | "not_in" | "is_null" | "not_null";
        /**
         * ActionConditionPredicate
         * @description Predicado atómico: compara el campo ``field`` del item con ``value``.
         *
         *     ``value`` es escalar para ``eq``/``neq``, una lista para ``in``/``not_in`` y se
         *     omite para ``is_null``/``not_null``. La validez se comprueba al construir el
         *     predicado (en el registro de la acción), no al evaluarlo.
         */
        ActionConditionPredicate: {
            /** Field */
            field: string;
            operator: components["schemas"]["ActionConditionOperator"];
            /** Value */
            value?: unknown | null;
        };
        /** ActionConfirmation */
        ActionConfirmation: {
            /** Required */
            required: boolean;
            /** Title */
            title: string;
            /** Message */
            message: string;
            /** Confirm Label */
            confirm_label: string;
            /** Destructive */
            destructive: boolean;
        };
        /**
         * ActionInputSchema
         * @description Formulario declarado de entrada de una acción (B2).
         *
         *     Sólo se publica cuando la acción declara un ``input_schema`` (en vez de un cuerpo
         *     fijo). Reusa exactamente la misma proyección de formularios que ``create``/``update``:
         *     cada campo es un ``ResourceFormFieldCapability`` (label, tipo, widget, obligatoriedad
         *     y opciones). Nunca se serializan defaults, validadores ni la clase Python.
         */
        ActionInputSchema: {
            /** Fields */
            fields: components["schemas"]["ResourceFormFieldCapability"][];
        };
        /**
         * ActionRequestSpec
         * @description Cuerpo fijo declarado por backend para una acción.
         *
         *     El frontend envía exactamente ``fixed_body`` (o vacío si no hay request): no
         *     puede agregar, quitar ni modificar campos, ni reutilizar la acción para otro
         *     payload.
         */
        ActionRequestSpec: {
            /** Content Type */
            content_type: string;
            /** Fixed Body */
            fixed_body: {
                [key: string]: unknown;
            };
        };
        /**
         * ActionScope
         * @enum {string}
         */
        ActionScope: "item";
        /**
         * ActionSuccessBehavior
         * @enum {string}
         */
        ActionSuccessBehavior: "refresh";
        /**
         * AuditEventListItem
         * @description Versión de listado compatible con ``ResourceQuery``.
         *
         *     Sólo campos factuales de la bitácora. ``changed_fields`` no se proyecta en el
         *     listado (puede ser voluminoso y contener detalle sensible); se ve en el detalle.
         */
        AuditEventListItem: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Fecha y hora
             * Format: date-time
             */
            occurred_at: string;
            /** Acción */
            action: string;
            /** Tipo de entidad */
            entity_type: string;
            /**
             * Entidad
             * Format: uuid
             */
            entity_id: string;
            /** Usuario */
            actor_user_id?: string | null;
            /** Motivo */
            reason?: string | null;
        };
        /**
         * AuditEventRead
         * @description Representación completa de un evento de auditoría (sólo lectura).
         */
        AuditEventRead: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Entity Type */
            entity_type: string;
            /**
             * Entity Id
             * Format: uuid
             */
            entity_id: string;
            /** Action */
            action: string;
            /** Actor User Id */
            actor_user_id?: string | null;
            /** Changed Fields */
            changed_fields?: {
                [key: string]: unknown;
            } | null;
            /** Reason */
            reason?: string | null;
            /**
             * Occurred At
             * Format: date-time
             */
            occurred_at: string;
        };
        /**
         * AuthPolicyRead
         * @description Política pública de auth que el frontend consume (no infiere de settings).
         */
        AuthPolicyRead: {
            /** Registration Enabled */
            registration_enabled: boolean;
            /** Password Reset Enabled */
            password_reset_enabled: boolean;
            /**
             * Google Login Enabled
             * @default false
             */
            google_login_enabled: boolean;
        };
        /**
         * BackupDriveStatus
         * @description Estado de la conexión con Google Drive para respaldos.
         *
         *     ``needs_reauth`` detiene los reintentos: el token dejó de servir y sólo una
         *     reconexión del administrador lo resuelve. Enum NO nativo (VARCHAR + CHECK); el
         *     valor más largo es ``needs_reauth`` (12).
         * @enum {string}
         */
        BackupDriveStatus: "disconnected" | "active" | "needs_reauth";
        /**
         * BackupExplorerStatus
         * @description Estado del artefacto de EXPLORACIÓN (SQLite legible) de un respaldo.
         *
         *     Independiente del status principal: un respaldo restaurable correcto sigue
         *     ``succeeded`` aunque su explorer haya fallado. Enum NO nativo (VARCHAR + CHECK);
         *     el valor más largo es ``not_requested`` (13).
         * @enum {string}
         */
        BackupExplorerStatus: "not_requested" | "building" | "ready" | "failed";
        /**
         * BackupRunListItem
         * @description Versión de listado del historial de respaldos.
         */
        BackupRunListItem: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Estado */
            status: components["schemas"]["BackupRunStatus"];
            /** Origen */
            trigger_kind: components["schemas"]["BackupTriggerKind"];
            /** Ventana */
            scheduled_for?: string | null;
            /** Inicio */
            started_at?: string | null;
            /** Fin */
            finished_at?: string | null;
            /** Archivo */
            file_name?: string | null;
            /** Tamaño (bytes) */
            file_size_bytes?: number | null;
            /** Retención */
            retention_roles: unknown[];
            /** Intentos */
            attempt_count: number;
            /** Error */
            error_code?: string | null;
            /** Explorador */
            explorer_status?: components["schemas"]["BackupExplorerStatus"] | null;
            /** Explorador (bytes) */
            explorer_file_size_bytes?: number | null;
            /**
             * Creado
             * Format: date-time
             */
            created_at: string;
        };
        /**
         * BackupRunRead
         * @description Detalle de una ejecución del historial (metadata operativa, nunca secretos).
         */
        BackupRunRead: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            status: components["schemas"]["BackupRunStatus"];
            trigger_kind: components["schemas"]["BackupTriggerKind"];
            /** Scheduled For */
            scheduled_for?: string | null;
            /** Next Attempt At */
            next_attempt_at?: string | null;
            /** Attempt Count */
            attempt_count: number;
            /** Started At */
            started_at?: string | null;
            /** Finished At */
            finished_at?: string | null;
            /** File Name */
            file_name?: string | null;
            /** File Size Bytes */
            file_size_bytes?: number | null;
            /** Ciphertext Sha256 */
            ciphertext_sha256?: string | null;
            /** Drive File Id */
            drive_file_id?: string | null;
            /** Drive Folder Id */
            drive_folder_id?: string | null;
            /** Encryption Fingerprint */
            encryption_fingerprint?: string | null;
            /** Retention Roles */
            retention_roles: unknown[];
            /** Error Code */
            error_code?: string | null;
            /** Error Summary */
            error_summary?: string | null;
            /** Pruned At */
            pruned_at?: string | null;
            explorer_status?: components["schemas"]["BackupExplorerStatus"] | null;
            /** Explorer File Size Bytes */
            explorer_file_size_bytes?: number | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Updated At */
            updated_at?: string | null;
        };
        /**
         * BackupRunStatus
         * @description Estado de una ejecución de respaldo (historial funcional).
         *
         *     Terminales: ``succeeded``, ``failed``, ``skipped`` y ``pruned`` (respaldo remoto
         *     rotado por retención; la fila se conserva). Enum NO nativo (VARCHAR + CHECK); el
         *     valor más largo es ``succeeded`` (9).
         * @enum {string}
         */
        BackupRunStatus: "queued" | "running" | "retrying" | "succeeded" | "failed" | "skipped" | "pruned";
        /**
         * BackupSettingsListItem
         * @description Versión de listado del singleton (una fila; la ALERTA persistente viaja aquí).
         */
        BackupSettingsListItem: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Habilitado */
            enabled: boolean;
            /** Zona horaria */
            timezone: string;
            /**
             * Hora diaria
             * Format: time
             */
            daily_time: string;
            /** Google Drive */
            drive_status: components["schemas"]["BackupDriveStatus"];
            /** Próximo respaldo */
            next_run_at?: string | null;
            /** Último error */
            last_error_code?: string | null;
            /** Error registrado */
            last_error_at?: string | null;
            /**
             * Creado
             * Format: date-time
             */
            created_at: string;
        };
        /**
         * BackupSettingsRead
         * @description Configuración completa (sin secretos: el token cifrado jamás se proyecta).
         */
        BackupSettingsRead: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Enabled */
            enabled: boolean;
            /** Timezone */
            timezone: string;
            /**
             * Daily Time
             * Format: time
             */
            daily_time: string;
            /** Next Run At */
            next_run_at?: string | null;
            /** Filename Prefix */
            filename_prefix: string;
            /** Retention Daily Count */
            retention_daily_count: number;
            /** Retention Monthly Count */
            retention_monthly_count: number;
            /** Retention Yearly Count */
            retention_yearly_count: number;
            /** Age Recipient */
            age_recipient?: string | null;
            /** Age Recipient Fingerprint */
            age_recipient_fingerprint?: string | null;
            /** Explorer Enabled */
            explorer_enabled: boolean;
            /** Google Drive Client Id */
            google_drive_client_id?: string | null;
            /** Google Drive Client Secret Configured */
            google_drive_client_secret_configured: boolean;
            /** Google Drive Redirect Uri */
            google_drive_redirect_uri?: string | null;
            drive_status: components["schemas"]["BackupDriveStatus"];
            /** Drive Folder Id */
            drive_folder_id?: string | null;
            /** Drive Connected At */
            drive_connected_at?: string | null;
            /** Last Error Code */
            last_error_code?: string | null;
            /** Last Error Summary */
            last_error_summary?: string | null;
            /** Last Error At */
            last_error_at?: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Updated At */
            updated_at?: string | null;
            /** Updated By */
            updated_by?: string | null;
        };
        /**
         * BackupSettingsUpdate
         * @description Actualización parcial de la configuración de respaldos (campos EDITABLES).
         *
         *     Las validaciones de fondo (zona IANA real, recipient de age utilizable, requisitos
         *     para ``enabled=true``) viven en el router/servicio; aquí van los rangos y formas.
         */
        BackupSettingsUpdate: {
            /**
             * Habilitado
             * @description Respaldo diario habilitado (requiere Drive conectado y cifrado configurado).
             */
            enabled?: boolean | null;
            /**
             * Zona horaria
             * @description Zona IANA en la que se interpreta la hora diaria (p. ej. America/Monterrey).
             */
            timezone?: string | null;
            /**
             * Hora diaria
             * @description Hora local del respaldo diario.
             */
            daily_time?: string | null;
            /**
             * Prefijo del archivo
             * @description 2-48 caracteres; letras, números, guion y guion bajo; inicia alfanumérico.
             */
            filename_prefix?: string | null;
            /** Copias diarias */
            retention_daily_count?: number | null;
            /** Copias mensuales */
            retention_monthly_count?: number | null;
            /** Copias anuales */
            retention_yearly_count?: number | null;
            /**
             * Artefacto de exploración
             * @description Genera el SQLite legible junto a cada respaldo (mismo snapshot).
             */
            explorer_enabled?: boolean | null;
            /**
             * Google Drive: client ID
             * @description Del cliente OAuth (tipo web) creado en Google Cloud.
             */
            google_drive_client_id?: string | null;
            /**
             * Google Drive: client secret (write-only)
             * @description Se guarda cifrado; nunca vuelve a mostrarse.
             */
            google_drive_client_secret?: string | null;
            /**
             * Recipient de age (clave pública, opcional)
             * @description OPCIONAL. Sin recipient el respaldo sube SIN cifrar (.tar); con la clave PÚBLICA age1… se cifra antes de subir (la privada nunca se sube).
             */
            age_recipient?: string | null;
        };
        /**
         * BackupTriggerKind
         * @description Origen de una ejecución de respaldo: programada o manual del administrador.
         * @enum {string}
         */
        BackupTriggerKind: "scheduled" | "manual";
        /** BootstrapAdditionalRole */
        BootstrapAdditionalRole: {
            /** Name */
            name: string;
            /** Description */
            description?: string | null;
            /** Permissions */
            permissions?: string[];
            /**
             * Assign To Initial User
             * @default false
             */
            assign_to_initial_user: boolean;
        };
        /** BootstrapCatalogRead */
        BootstrapCatalogRead: {
            /** Permission Groups */
            permission_groups: components["schemas"]["BootstrapPermissionGroupRead"][];
            limits: components["schemas"]["BootstrapLimitsRead"];
        };
        /** BootstrapInitialUser */
        BootstrapInitialUser: {
            /** Name */
            name: string;
            /** Last Name */
            last_name: string;
            /**
             * Email
             * Format: email
             */
            email: string;
            /**
             * Password
             * Format: password
             */
            password: string;
            /**
             * Confirm Password
             * Format: password
             */
            confirm_password: string;
        };
        /** BootstrapInitializeRead */
        BootstrapInitializeRead: {
            /** Setup Complete */
            setup_complete: boolean;
        };
        /** BootstrapInitializeRequest */
        BootstrapInitializeRequest: {
            user: components["schemas"]["BootstrapInitialUser"];
            system_admin_role?: components["schemas"]["BootstrapSystemAdminRole"];
            /** Additional Roles */
            additional_roles?: components["schemas"]["BootstrapAdditionalRole"][];
            /**
             * Public Registration Enabled
             * @description Permitir el auto-registro público desde el primer momento.
             * @default false
             */
            public_registration_enabled: boolean;
            /**
             * Password Reset Enabled
             * @description Permitir la recuperación de contraseña por correo.
             * @default true
             */
            password_reset_enabled: boolean;
            /**
             * Institution Name
             * @description Nombre de la institución (opcional).
             */
            institution_name?: string | null;
        };
        /** BootstrapLimitsRead */
        BootstrapLimitsRead: {
            /** Max Additional Roles */
            max_additional_roles: number;
        };
        /** BootstrapPermissionGroupRead */
        BootstrapPermissionGroupRead: {
            /** Name */
            name: string;
            /** Label */
            label: string;
            /** Permissions */
            permissions: components["schemas"]["BootstrapPermissionRead"][];
        };
        /** BootstrapPermissionRead */
        BootstrapPermissionRead: {
            /** Access */
            access: string;
            /** Label */
            label: string;
            /** Description */
            description?: string | null;
        };
        /** BootstrapStatusRead */
        BootstrapStatusRead: {
            /** Setup Required */
            setup_required: boolean;
            /** Token Required */
            token_required: boolean;
        };
        /** BootstrapSystemAdminRole */
        BootstrapSystemAdminRole: {
            /**
             * Label
             * @default Administrador de plataforma
             */
            label: string;
            /**
             * Description
             * @default Administración inicial de la plataforma
             */
            description: string | null;
        };
        /**
         * ConnectDriveResponse
         * @description Respuesta de la acción conectar Drive: URL de autorización de Google.
         */
        ConnectDriveResponse: {
            /** Authorization Url */
            authorization_url: string;
        };
        /**
         * DriveBackupFileRead
         * @description Archivo REAL guardado en la carpeta de respaldos de Google Drive (fase inicial
         *     del explorador: ver qué hay y descargarlo; sin exploración todavía).
         */
        DriveBackupFileRead: {
            /** File Id */
            file_id: string;
            /** Name */
            name: string;
            /** Size Bytes */
            size_bytes?: number | null;
            /** Created Time */
            created_time?: string | null;
            /** Artifact Kind */
            artifact_kind: string;
            /** Backup Run Id */
            backup_run_id?: string | null;
        };
        /**
         * DriveBackupFilesResponse
         * @description Listado de la carpeta de Drive (más reciente primero).
         */
        DriveBackupFilesResponse: {
            /** Folder Id */
            folder_id: string;
            /** Files */
            files: components["schemas"]["DriveBackupFileRead"][];
        };
        /**
         * FieldValueType
         * @enum {string}
         */
        FieldValueType: "string" | "email" | "uuid" | "integer" | "decimal" | "boolean" | "date" | "time" | "datetime" | "enum" | "array";
        /**
         * FilterOperator
         * @enum {string}
         */
        FilterOperator: "eq" | "ne" | "contains" | "starts_with" | "ends_with" | "gte" | "lte" | "on" | "before" | "after" | "between" | "in" | "isnull";
        /**
         * FilterValueShape
         * @enum {string}
         */
        FilterValueShape: "single" | "range";
        /**
         * FilterableFieldCapability
         * @description Campo filtrable y los operadores que expone (contrato visible de filtros).
         *
         *     Fuente declarativa única: los operadores se derivan del plan compilado del recurso
         *     (``QueryOptions``/``field_operators``); el frontend no infiere parámetros ni sufijos.
         */
        FilterableFieldCapability: {
            /** Key */
            key: string;
            /** Label */
            label: string;
            /** Description */
            description?: string | null;
            value_type: components["schemas"]["FieldValueType"];
            /** Operators */
            operators: components["schemas"]["FilterableOperatorCapability"][];
        };
        /**
         * FilterableOperatorCapability
         * @description Un operador concreto que un campo expone como filtro visible.
         *
         *     ``parameter_name`` (operadores de un solo parámetro) y ``parameters`` (rango) son
         *     mutuamente excluyentes. ``value_shape`` indica cómo capturar el valor; ``widget``,
         *     cómo renderizarlo. Los flags opcionales describen la semántica que el frontend debe
         *     respetar pero no inferir (case-sensitivity, zona horaria de calendario, inclusión
         *     del extremo superior del rango, multiplicidad).
         */
        FilterableOperatorCapability: {
            key: components["schemas"]["FilterOperator"];
            /** Label */
            label: string;
            value_shape: components["schemas"]["FilterValueShape"];
            widget: components["schemas"]["WidgetType"];
            /** Parameter Name */
            parameter_name?: string | null;
            parameters?: components["schemas"]["FilterableRangeParameters"] | null;
            /** Case Sensitive */
            case_sensitive?: boolean | null;
            /** Calendar Timezone */
            calendar_timezone?: string | null;
            /** Range End Inclusive */
            range_end_inclusive?: boolean | null;
            /** Multiple */
            multiple?: boolean | null;
            /** Options */
            options?: components["schemas"]["ResourceFilterOption"][] | null;
            /** Max Values */
            max_values?: number | null;
            /** Placeholder */
            placeholder?: string | null;
        };
        /**
         * FilterableRangeParameters
         * @description Nombres de parámetro de los dos extremos de un operador de rango (``between``).
         */
        FilterableRangeParameters: {
            /** From */
            from: string;
            /** To */
            to: string;
        };
        /** ForgotPasswordRequest */
        ForgotPasswordRequest: {
            /**
             * Email
             * Format: email
             */
            email: string;
        };
        /**
         * FormTransport
         * @enum {string}
         */
        FormTransport: "json" | "multipart";
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** HealthRead */
        HealthRead: {
            /**
             * Status
             * @constant
             */
            status: "ok";
        };
        /**
         * HttpMethod
         * @enum {string}
         */
        HttpMethod: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
        /**
         * ItemReference
         * @description Referencia pública y estable de un item de listado.
         *
         *     No se llama ``primary_key`` ni expone bindings ORM: declara qué campo de cada
         *     item identifica el recurso (``field``), qué token usan las plantillas de URL
         *     (``placeholder``, p. ej. ``{id}``) y su tipo. El frontend nunca asume ``id``.
         */
        ItemReference: {
            /** Field */
            field: string;
            /** Placeholder */
            placeholder: string;
            type: components["schemas"]["FieldValueType"];
        };
        /** LoginRequest */
        LoginRequest: {
            /**
             * Email
             * Format: email
             */
            email: string;
            /**
             * Password
             * Format: password
             */
            password: string;
        };
        /**
         * LoginResponse
         * @description Desenlace del login: sesión creada o reto de verificación por correo.
         */
        LoginResponse: {
            /** Message */
            message: string;
            /**
             * Verification Required
             * @default false
             */
            verification_required: boolean;
            /** Verification Mode */
            verification_mode?: string | null;
        };
        /**
         * LoginVerifyRequest
         * @description Secreto del reto: el código de 6 dígitos o el token del enlace.
         */
        LoginVerifyRequest: {
            /** Code */
            code: string;
        };
        /** MessageResponse */
        MessageResponse: {
            /** Message */
            message: string;
        };
        /** OffsetPage[AuditEventListItem] */
        OffsetPage_AuditEventListItem_: {
            /** Items */
            items: components["schemas"]["AuditEventListItem"][];
            pagination: components["schemas"]["OffsetPagination"];
        };
        /** OffsetPage[BackupRunListItem] */
        OffsetPage_BackupRunListItem_: {
            /** Items */
            items: components["schemas"]["BackupRunListItem"][];
            pagination: components["schemas"]["OffsetPagination"];
        };
        /** OffsetPage[BackupSettingsListItem] */
        OffsetPage_BackupSettingsListItem_: {
            /** Items */
            items: components["schemas"]["BackupSettingsListItem"][];
            pagination: components["schemas"]["OffsetPagination"];
        };
        /** OffsetPage[RoleListItem] */
        OffsetPage_RoleListItem_: {
            /** Items */
            items: components["schemas"]["RoleListItem"][];
            pagination: components["schemas"]["OffsetPagination"];
        };
        /** OffsetPage[RoleRead] */
        OffsetPage_RoleRead_: {
            /** Items */
            items: components["schemas"]["RoleRead"][];
            pagination: components["schemas"]["OffsetPagination"];
        };
        /** OffsetPage[SystemSettingsListItem] */
        OffsetPage_SystemSettingsListItem_: {
            /** Items */
            items: components["schemas"]["SystemSettingsListItem"][];
            pagination: components["schemas"]["OffsetPagination"];
        };
        /** OffsetPage[UserAdminListItem] */
        OffsetPage_UserAdminListItem_: {
            /** Items */
            items: components["schemas"]["UserAdminListItem"][];
            pagination: components["schemas"]["OffsetPagination"];
        };
        /** OffsetPagination */
        OffsetPagination: {
            /**
             * Limit
             * @default 20
             */
            limit: number;
            /**
             * Offset
             * @default 0
             */
            offset: number;
            /** Has Next */
            has_next: boolean;
            /** Total */
            total: number;
        };
        /**
         * OptionsSourceType
         * @enum {string}
         */
        OptionsSourceType: "list" | "grouped_catalog";
        /** PaginationCapability */
        PaginationCapability: {
            /** Default Limit */
            default_limit: number;
            /** Max Limit */
            max_limit: number;
        };
        /** PermissionGroupRead */
        PermissionGroupRead: {
            /** Name */
            name: string;
            /** Label */
            label: string;
            /** Permissions */
            permissions: components["schemas"]["PermissionRead"][];
        };
        /** PermissionRead */
        PermissionRead: {
            /** Access */
            access: string;
            /** Label */
            label: string;
            /** Description */
            description?: string | null;
        };
        /** ReadinessRead */
        ReadinessRead: {
            /**
             * Status
             * @constant
             */
            status: "ok";
            /** Checks */
            checks: {
                [key: string]: boolean;
            };
        };
        /** RegisterCompleteRequest */
        RegisterCompleteRequest: {
            /** First Name */
            first_name: string;
            /** Last Name */
            last_name: string;
            /** Token */
            token: string;
            /**
             * Email
             * Format: email
             */
            email: string;
            /**
             * Password
             * Format: password
             */
            password: string;
            /**
             * Confirm Password
             * Format: password
             */
            confirm_password: string;
        };
        /** RegisterRequest */
        RegisterRequest: {
            /**
             * Email
             * Format: email
             */
            email: string;
        };
        /**
         * RelationOptionsSource
         * @description Origen declarado del universo de opciones de un editor relacional.
         */
        RelationOptionsSource: {
            type: components["schemas"]["OptionsSourceType"];
            /** Url */
            url: string;
            /** Value Field */
            value_field: string;
            /** Label Field */
            label_field: string;
        };
        /** ResetPasswordRequest */
        ResetPasswordRequest: {
            /**
             * Email
             * Format: email
             */
            email: string;
            /** Token */
            token: string;
            /**
             * Password
             * Format: password
             */
            password: string;
            /**
             * Confirm Password
             * Format: password
             */
            confirm_password: string;
        };
        /** ResourceActionCapability */
        ResourceActionCapability: {
            /** Name */
            name: string;
            /** Label */
            label: string;
            method: components["schemas"]["HttpMethod"];
            /** Url Template */
            url_template: string;
            scope: components["schemas"]["ActionScope"];
            /** Danger */
            danger: boolean;
            request?: components["schemas"]["ActionRequestSpec"] | null;
            input_schema?: components["schemas"]["ActionInputSchema"] | null;
            confirmation?: components["schemas"]["ActionConfirmation"] | null;
            /** @default refresh */
            success_behavior: components["schemas"]["ActionSuccessBehavior"];
            visible_when?: components["schemas"]["ActionCondition"] | null;
            enabled_when?: components["schemas"]["ActionCondition"] | null;
        };
        /** ResourceCapability */
        ResourceCapability: {
            /** Name */
            name: string;
            /** Label */
            label: string;
            /** Api Path */
            api_path: string;
            view: components["schemas"]["ResourceView"];
            item_reference?: components["schemas"]["ItemReference"] | null;
            detail?: components["schemas"]["ResourceDetailCapability"] | null;
            file_download?: components["schemas"]["ResourceFileDownloadCapability"] | null;
            list?: components["schemas"]["ResourceListCapability"] | null;
            forms?: components["schemas"]["ResourceFormsCapability"] | null;
            /**
             * Actions
             * @default []
             */
            actions: components["schemas"]["ResourceActionCapability"][];
            /**
             * Relations
             * @default []
             */
            relations: components["schemas"]["ResourceRelationCapability"][];
            /**
             * Related Lists
             * @default []
             */
            related_lists: components["schemas"]["ResourceRelatedListCapability"][];
        };
        /**
         * ResourceDetailCapability
         * @description Lectura individual declarada de un recurso (precarga de formularios).
         */
        ResourceDetailCapability: {
            method: components["schemas"]["HttpMethod"];
            /** Url Template */
            url_template: string;
        };
        /** ResourceFieldCapability */
        ResourceFieldCapability: {
            /** Name */
            name: string;
            /** Label */
            label: string;
            /** Description */
            description?: string | null;
            type: components["schemas"]["FieldValueType"];
            /** Visible In List */
            visible_in_list: boolean;
            /** Sortable */
            sortable: boolean;
            /** Searchable */
            searchable: boolean;
            /** Filter Operators */
            filter_operators: components["schemas"]["FilterOperator"][];
        };
        /**
         * ResourceFileDownloadCapability
         * @description Descarga de contenido binario de un item (navegación de archivo, no mutación).
         *
         *     Genérico: cualquier recurso con contenido descargable la declara. Se proyecta solo
         *     si el actor tiene el permiso de descarga (distinto del de lectura de metadata). El
         *     backend revalida permiso y visibilidad y entrega el binario con cabeceras seguras.
         */
        ResourceFileDownloadCapability: {
            method: components["schemas"]["HttpMethod"];
            /** Url Template */
            url_template: string;
        };
        /**
         * ResourceFileFieldCapability
         * @description Campo de archivo de un formulario multipart (genérico, sin semántica de dominio).
         *
         *     El frontend usa ``accepted_mime_types`` y ``max_size_bytes`` solo como guía de UI; el
         *     backend revalida tamaño y tipo en cada carga.
         */
        ResourceFileFieldCapability: {
            /** Name */
            name: string;
            /** Label */
            label: string;
            /** Accepted Mime Types */
            accepted_mime_types: string[];
            /** Max Size Bytes */
            max_size_bytes: number;
            /** Required */
            required: boolean;
        };
        /** ResourceFilterOption */
        ResourceFilterOption: {
            /** Value */
            value: string;
            /** Label */
            label: string;
        };
        /** ResourceFormCapability */
        ResourceFormCapability: {
            method: components["schemas"]["HttpMethod"];
            /** Url Template */
            url_template: string;
            /** Fields */
            fields: components["schemas"]["ResourceFormFieldCapability"][];
            /** @default json */
            transport: components["schemas"]["FormTransport"];
            file_field?: components["schemas"]["ResourceFileFieldCapability"] | null;
        };
        /** ResourceFormFieldCapability */
        ResourceFormFieldCapability: {
            /** Name */
            name: string;
            /** Label */
            label: string;
            /** Description */
            description?: string | null;
            type: components["schemas"]["FieldValueType"];
            /** Required */
            required: boolean;
            /**
             * Editable
             * @default true
             */
            editable: boolean;
            widget?: components["schemas"]["WidgetType"] | null;
            /** Options */
            options?: components["schemas"]["ResourceFilterOption"][] | null;
        };
        /** ResourceFormsCapability */
        ResourceFormsCapability: {
            create?: components["schemas"]["ResourceFormCapability"] | null;
            update?: components["schemas"]["ResourceFormCapability"] | null;
        };
        /** ResourceListCapability */
        ResourceListCapability: {
            /** Fields */
            fields: components["schemas"]["ResourceFieldCapability"][];
            /**
             * Filterable Fields
             * @default []
             */
            filterable_fields: components["schemas"]["FilterableFieldCapability"][];
            pagination: components["schemas"]["PaginationCapability"];
            search: components["schemas"]["SearchCapability"];
            sort: components["schemas"]["SortCapability"];
        };
        /**
         * ResourceRelatedListCapability
         * @description Lista RELACIONADA navegable por item (p. ej. signos vitales de una consulta).
         *
         *     Es navegación de solo lectura, no un editor: el frontend enlaza a la lista del
         *     recurso destino con ``parameter_name=<valor de la referencia del item>`` (el
         *     filtro EQ ya publicado por ``filterable_fields`` del destino). Se proyecta solo
         *     si el actor tiene el permiso de LECTURA del recurso destino.
         */
        ResourceRelatedListCapability: {
            /** Resource */
            resource: string;
            /** Label */
            label: string;
            /** Parameter Name */
            parameter_name: string;
        };
        /**
         * ResourceRelationCapability
         * @description Editor relacional declarado por el backend (p. ej. roles de un usuario).
         *
         *     El frontend no infiere rutas ni cardinalidad desde nombres: consume estas URLs
         *     y campos. ``selection_url`` y ``mutation_url`` son plantillas con ``{id}`` del
         *     recurso dueño. ``request_field`` es el campo del cuerpo que transporta la lista
         *     completa de valores objetivo (reemplazo atómico).
         */
        ResourceRelationCapability: {
            /** Name */
            name: string;
            /** Label */
            label: string;
            /** Description */
            description?: string | null;
            /** Required */
            required: boolean;
            /** Editable */
            editable: boolean;
            /** Selection Url */
            selection_url: string;
            /** Selection Field */
            selection_field?: string | null;
            mutation_method: components["schemas"]["HttpMethod"];
            /** Mutation Url */
            mutation_url: string;
            /** Request Field */
            request_field: string;
            options: components["schemas"]["RelationOptionsSource"];
        };
        /**
         * ResourceView
         * @enum {string}
         */
        ResourceView: "table" | "grouped_catalog";
        /** RoleCreate */
        RoleCreate: {
            /** Nombre */
            name: string;
            /** Descripción */
            description?: string | null;
            /** Permissions */
            permissions?: string[];
        };
        /**
         * RoleDetailRead
         * @description Detalle de rol incluyendo los permisos asignados.
         */
        RoleDetailRead: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Name */
            name: string;
            /** Description */
            description?: string | null;
            /** Is Active */
            is_active: boolean;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Updated At */
            updated_at?: string | null;
            /** Permissions */
            permissions: string[];
        };
        /**
         * RoleListItem
         * @description Versión de listado compatible con ``ResourceQuery``.
         *
         *     Redeclara los campos visibles en lista con metadata UI explícita. ``id`` se
         *     hereda sin ``ui`` y por tanto no se proyecta como columna por defecto.
         */
        RoleListItem: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Nombre */
            name: string;
            /** Descripción */
            description?: string | null;
            /** Activo */
            is_active: boolean;
            /**
             * Creado
             * Format: date-time
             */
            created_at: string;
            /** Actualizado */
            updated_at?: string | null;
        };
        /**
         * RolePermissionsRead
         * @description Selección actual de permisos de un rol (lectura para el editor relacional).
         */
        RolePermissionsRead: {
            /** Permissions */
            permissions: string[];
        };
        /**
         * RolePermissionsReplace
         * @description Reemplazo completo de permisos asignados a un rol (PUT).
         */
        RolePermissionsReplace: {
            /** Permissions */
            permissions: string[];
        };
        /** RoleRead */
        RoleRead: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Name */
            name: string;
            /** Description */
            description?: string | null;
            /** Is Active */
            is_active: boolean;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Updated At */
            updated_at?: string | null;
        };
        /** RoleUpdate */
        RoleUpdate: {
            /** Nombre */
            name?: string | null;
            /** Descripción */
            description?: string | null;
            /** Activo */
            is_active?: boolean | null;
        };
        /** SearchCapability */
        SearchCapability: {
            /** Enabled */
            enabled: boolean;
            /** Min Length */
            min_length?: number | null;
            /** Max Length */
            max_length?: number | null;
        };
        /**
         * SendTestEmailRequest
         * @description Cuerpo de la acción de correo de prueba (destinatario opcional: default el
         *     administrador que la ejecuta).
         */
        SendTestEmailRequest: {
            /** Destinatario (opcional) */
            recipient?: string | null;
        };
        /** SessionUser */
        SessionUser: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Name */
            name: string;
            /** Last Name */
            last_name: string;
            /**
             * Email
             * Format: email
             */
            email: string;
            /** Permissions */
            permissions?: string[];
        };
        /**
         * SetupChecklistItemRead
         * @description Ítem del checklist de puesta en marcha (estado derivado).
         */
        SetupChecklistItemRead: {
            /** Key */
            key: string;
            /** Title */
            title: string;
            /**
             * Status
             * @enum {string}
             */
            status: "complete" | "pending" | "not_applicable";
            /** Detail */
            detail: string;
        };
        /**
         * SetupChecklistRead
         * @description Checklist derivado + si el administrador lo descartó.
         */
        SetupChecklistRead: {
            /** Items */
            items: components["schemas"]["SetupChecklistItemRead"][];
            /** Dismissed */
            dismissed: boolean;
            /** Pending Count */
            pending_count: number;
            /** Environment */
            environment: string;
        };
        /** SortCapability */
        SortCapability: {
            /** Default Sort */
            default_sort?: string | null;
            /** Fixed Server Order */
            fixed_server_order: boolean;
            /** Max Terms */
            max_terms: number;
            /** Max Length */
            max_length: number;
        };
        /**
         * SystemSettingsListItem
         * @description Versión de listado del singleton (una fila).
         */
        SystemSettingsListItem: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Institución */
            institution_name?: string | null;
            /** Registro público */
            public_registration_enabled: boolean;
            /** Dominio */
            app_base_url?: string | null;
            /** Actualizado */
            updated_at?: string | null;
            /**
             * Creado
             * Format: date-time
             */
            created_at: string;
        };
        /**
         * SystemSettingsRead
         * @description Estado completo y SEGURO de la configuración del sistema.
         */
        SystemSettingsRead: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Public Registration Enabled */
            public_registration_enabled: boolean;
            /** Registration Allowed By Deployment */
            registration_allowed_by_deployment: boolean;
            /** Public Registration Effective */
            public_registration_effective: boolean;
            /** App Base Url */
            app_base_url?: string | null;
            /** App Base Url Verified At */
            app_base_url_verified_at?: string | null;
            /** Institution Name */
            institution_name?: string | null;
            /** Login Verification Mode */
            login_verification_mode: string;
            /** Google Login Enabled */
            google_login_enabled: boolean;
            /** Google Auth Client Id */
            google_auth_client_id?: string | null;
            /** Google Auth Client Secret Configured */
            google_auth_client_secret_configured: boolean;
            /** Password Reset Enabled */
            password_reset_enabled: boolean;
            /** Email Mode */
            email_mode: string;
            /** Email From Address */
            email_from_address?: string | null;
            /** Email From Name */
            email_from_name?: string | null;
            /** Email Smtp Host */
            email_smtp_host?: string | null;
            /** Email Smtp Port */
            email_smtp_port?: number | null;
            /** Email Smtp Username */
            email_smtp_username?: string | null;
            /** Email Smtp Tls */
            email_smtp_tls: boolean;
            /** Email Smtp Ssl */
            email_smtp_ssl: boolean;
            /** Email Smtp Password Configured */
            email_smtp_password_configured: boolean;
            /** Email Resend Api Key Configured */
            email_resend_api_key_configured: boolean;
            /** Email Last Test At */
            email_last_test_at?: string | null;
            /** Email Last Test Status */
            email_last_test_status?: string | null;
            /** Email Last Test Error */
            email_last_test_error?: string | null;
            /** Email Transport Reason */
            email_transport_reason?: string | null;
            /** Environment */
            environment: string;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Updated At */
            updated_at?: string | null;
            /** Updated By */
            updated_by?: string | null;
        };
        /**
         * SystemSettingsUpdate
         * @description Campos EDITABLES de la política del sistema.
         */
        SystemSettingsUpdate: {
            /**
             * Registro público
             * @description Permitir el auto-registro por correo. Sólo tiene efecto si el despliegue lo permite (candado del entorno).
             */
            public_registration_enabled?: boolean | null;
            /**
             * Nombre de la institución
             * @description Nombre de la institución para membretes y encabezados.
             */
            institution_name?: string | null;
            /**
             * Verificación de inicio de sesión
             * @description Segundo paso por correo en cada login: código de un solo uso o enlace. Requiere transporte de correo utilizable. Los administradores con cobertura completa quedan exentos siempre (garantía anti-bloqueo).
             */
            login_verification_mode?: ("disabled" | "code" | "link") | null;
            /**
             * Recuperación de contraseña
             * @description Permitir restablecer contraseña por correo. AVISO: apagarla con el registro cerrado y un solo administrador puede dejar la instalación sin acceso (la salida es el seed del servidor).
             */
            password_reset_enabled?: boolean | null;
            /**
             * Transporte de correo
             * @description environment: SMTP del despliegue (Mailpit en desarrollo); smtp/resend: credenciales guardadas aquí (cifradas).
             */
            email_mode?: ("environment" | "smtp" | "resend") | null;
            /**
             * Remitente
             * @description Correo remitente (modos smtp/resend).
             */
            email_from_address?: string | null;
            /** Nombre del remitente */
            email_from_name?: string | null;
            /** Servidor SMTP */
            email_smtp_host?: string | null;
            /** Puerto SMTP */
            email_smtp_port?: number | null;
            /** Usuario SMTP */
            email_smtp_username?: string | null;
            /** STARTTLS */
            email_smtp_tls?: boolean | null;
            /** SSL directo */
            email_smtp_ssl?: boolean | null;
            /**
             * Inicio de sesión con Google
             * @description Muestra 'Continuar con Google' en el login. Requiere client ID y secret configurados. El alta de cuentas nuevas exige además el registro público habilitado.
             */
            google_login_enabled?: boolean | null;
            /** Client ID de Google (login) */
            google_auth_client_id?: string | null;
            /**
             * Client secret de Google (write-only)
             * @description Se guarda cifrado; nunca vuelve a mostrarse.
             */
            google_auth_client_secret?: string | null;
            /**
             * Contraseña SMTP (write-only)
             * @description Se guarda cifrada; nunca vuelve a mostrarse.
             */
            email_smtp_password?: string | null;
            /**
             * API key de Resend (write-only)
             * @description Se guarda cifrada; nunca vuelve a mostrarse.
             */
            email_resend_api_key?: string | null;
        };
        /** UnlockAccountRequest */
        UnlockAccountRequest: {
            /** Token */
            token: string;
        };
        /**
         * UserAdminCreate
         * @description Creación administrativa de un usuario.
         */
        UserAdminCreate: {
            /** Nombre */
            name: string;
            /** Apellido */
            last_name: string;
            /**
             * Correo
             * Format: email
             */
            email: string;
            /**
             * Contraseña
             * Format: password
             */
            password: string;
            /**
             * Confirmar contraseña
             * Format: password
             */
            confirm_password: string;
            /**
             * Activo
             * @default true
             */
            is_active: boolean;
        };
        /**
         * UserAdminListItem
         * @description Versión reducida para listados administrativos de usuarios.
         */
        UserAdminListItem: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Nombre */
            name: string;
            /** Apellido */
            last_name: string;
            /**
             * Correo
             * Format: email
             */
            email: string;
            /** Activo */
            is_active: boolean;
            /**
             * Creado
             * Format: date-time
             */
            created_at: string;
        };
        /**
         * UserAdminRead
         * @description Representación administrativa completa de un usuario.
         */
        UserAdminRead: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Name */
            name: string;
            /** Last Name */
            last_name: string;
            /**
             * Email
             * Format: email
             */
            email: string;
            /** Is Active */
            is_active: boolean;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Updated At */
            updated_at?: string | null;
        };
        /**
         * UserAdminUpdate
         * @description Actualización parcial administrativa de un usuario (PATCH).
         */
        UserAdminUpdate: {
            /** Nombre */
            name?: string | null;
            /** Apellido */
            last_name?: string | null;
            /** Correo */
            email?: string | null;
            /** Activo */
            is_active?: boolean | null;
        };
        /**
         * UserPasswordChangeRequest
         * @description Cambio de contraseña solicitado por el propio usuario.
         */
        UserPasswordChangeRequest: {
            /**
             * Current Password
             * Format: password
             */
            current_password: string;
            /**
             * Password
             * Format: password
             */
            password: string;
            /**
             * Confirm Password
             * Format: password
             */
            confirm_password: string;
        };
        /**
         * UserProfileRead
         * @description Datos propios visibles para el usuario autenticado.
         */
        UserProfileRead: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Name */
            name: string;
            /** Last Name */
            last_name: string;
            /**
             * Email
             * Format: email
             */
            email: string;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Updated At */
            updated_at?: string | null;
        };
        /**
         * UserProfileUpdate
         * @description Campos que el usuario puede editar sobre su propio perfil.
         */
        UserProfileUpdate: {
            /** Name */
            name?: string | null;
            /** Last Name */
            last_name?: string | null;
            /** Email */
            email?: string | null;
        };
        /**
         * UserRolesReplace
         * @description Reemplazo completo de los roles asignados a un usuario (PUT).
         */
        UserRolesReplace: {
            /** Role Ids */
            role_ids: string[];
        };
        /** ValidationError */
        ValidationError: {
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
            /** Input */
            input?: unknown;
            /** Context */
            ctx?: Record<string, never>;
        };
        /**
         * VerifyDomainRequest
         * @description Cuerpo de la verificación de dominio (sin valor: se deriva del Origin).
         */
        VerifyDomainRequest: {
            /**
             * Dominio base (opcional)
             * @description https://tu-dominio; vacío = el dominio por el que navegas ahora.
             */
            base_url?: string | null;
        };
        /**
         * WidgetType
         * @enum {string}
         */
        WidgetType: "text" | "email" | "password" | "switch" | "textarea" | "multiselect" | "select" | "number" | "date" | "daterange" | "datetime" | "time";
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    health_api_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthRead"];
                };
            };
        };
    };
    readiness_api_ready_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReadinessRead"];
                };
            };
        };
    };
    list_audit_events_api_v1_audit_events_get: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
                /** @description Campos de orden separados por coma. Use '-' para orden descendente. */
                sort?: string;
                actor_user_id?: string | null;
                action?: string | null;
                entity_type?: string | null;
                entity_id?: string | null;
                id_in?: string[] | null;
                occurred_at_on?: string | null;
                occurred_at_before?: string | null;
                occurred_at_after?: string | null;
                occurred_at_from?: string | null;
                occurred_at_to?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OffsetPage_AuditEventListItem_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_audit_event_api_v1_audit_events__event_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                event_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditEventRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    read_auth_policy_api_v1_auth_policy_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthPolicyRead"];
                };
            };
        };
    };
    read_current_user_api_v1_auth_me_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionUser"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    login_api_v1_auth_login_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    verify_login_api_v1_auth_login_verify_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginVerifyRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    google_login_start_api_v1_auth_google_start_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    google_login_callback_api_v1_auth_google_callback_get: {
        parameters: {
            query?: {
                code?: string;
                state?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    logout_api_v1_auth_logout_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessageResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    request_registration_api_v1_auth_register_request_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegisterRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessageResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    complete_registration_api_v1_auth_register_complete_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegisterCompleteRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessageResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    unlock_account_api_v1_auth_unlock_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UnlockAccountRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessageResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    request_password_reset_api_v1_auth_password_forgot_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ForgotPasswordRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessageResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    complete_password_reset_api_v1_auth_password_reset_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResetPasswordRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessageResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_backup_settings_api_v1_backup_settings_get: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
                /** @description Campos de orden separados por coma. Use '-' para orden descendente. */
                sort?: string;
                id_in?: string[] | null;
            };
            header?: never;
            path?: never;
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OffsetPage_BackupSettingsListItem_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_backup_settings_detail_api_v1_backup_settings__item_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                item_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BackupSettingsRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_backup_settings_api_v1_backup_settings__item_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                item_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BackupSettingsUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BackupSettingsRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    generate_encryption_key_api_v1_backup_settings__item_id__generate_encryption_key_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                item_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BackupSettingsRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    connect_drive_api_v1_backup_settings__item_id__connect_drive_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                item_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConnectDriveResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    google_drive_callback_api_v1_backups_google_drive_callback_get: {
        parameters: {
            query?: {
                code?: string | null;
                state?: string | null;
                error?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    disconnect_drive_api_v1_backup_settings__item_id__disconnect_drive_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                item_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BackupSettingsRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    run_backup_now_api_v1_backup_settings__item_id__run_now_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                item_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BackupRunRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_backup_runs_api_v1_backup_runs_get: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
                /** @description Campos de orden separados por coma. Use '-' para orden descendente. */
                sort?: string;
                status?: components["schemas"]["BackupRunStatus"] | null;
                trigger_kind?: components["schemas"]["BackupTriggerKind"] | null;
                id_in?: string[] | null;
                created_at_on?: string | null;
                created_at_before?: string | null;
                created_at_after?: string | null;
                created_at_from?: string | null;
                created_at_to?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OffsetPage_BackupRunListItem_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_backup_run_api_v1_backup_runs__item_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                item_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BackupRunRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_drive_backup_files_api_v1_backups_drive_files_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DriveBackupFilesResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    download_drive_backup_file_api_v1_backups_drive_files__file_id__download_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                file_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    read_bootstrap_status_api_v1_bootstrap_status_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BootstrapStatusRead"];
                };
            };
        };
    };
    read_bootstrap_catalog_api_v1_bootstrap_catalog_get: {
        parameters: {
            query?: never;
            header?: {
                "X-Bootstrap-Token"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BootstrapCatalogRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    initialize_bootstrap_api_v1_bootstrap_initialize_post: {
        parameters: {
            query?: never;
            header?: {
                "X-Bootstrap-Token"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BootstrapInitializeRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BootstrapInitializeRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_permissions_api_v1_permissions_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PermissionGroupRead"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_resources_api_v1_resources_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResourceCapability"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_resource_capability_api_v1_resources__resource_name__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                resource_name: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResourceCapability"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_roles_api_v1_roles_get: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
                /** @description Campos de orden separados por coma. Use '-' para orden descendente. */
                sort?: string;
                is_active?: boolean | null;
                name?: string | null;
                id_in?: string[] | null;
                name_ne?: string | null;
                name_contains?: string | null;
                name_startswith?: string | null;
                name_endswith?: string | null;
                created_at_on?: string | null;
                created_at_before?: string | null;
                created_at_after?: string | null;
                created_at_from?: string | null;
                created_at_to?: string | null;
                q?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OffsetPage_RoleListItem_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_role_api_v1_roles_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RoleCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoleDetailRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_role_api_v1_roles__role_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                role_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoleDetailRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_role_api_v1_roles__role_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                role_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoleRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_role_api_v1_roles__role_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                role_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RoleUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoleRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_role_permissions_api_v1_roles__role_id__permissions_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                role_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RolePermissionsRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    replace_role_permissions_api_v1_roles__role_id__permissions_put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                role_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RolePermissionsReplace"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoleDetailRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_system_settings_api_v1_system_settings_get: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
                /** @description Campos de orden separados por coma. Use '-' para orden descendente. */
                sort?: string;
                id_in?: string[] | null;
            };
            header?: never;
            path?: never;
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OffsetPage_SystemSettingsListItem_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_setup_checklist_api_v1_system_settings_setup_checklist_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SetupChecklistRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    dismiss_setup_checklist_api_v1_system_settings_setup_checklist_dismiss_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    domain_challenge_api_v1_domain_challenge__nonce__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                nonce: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    verify_domain_api_v1_system_settings__item_id__verify_domain_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                item_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VerifyDomainRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemSettingsRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    send_test_email_api_v1_system_settings__item_id__send_test_email_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                item_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SendTestEmailRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemSettingsRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_system_settings_detail_api_v1_system_settings__item_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                item_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemSettingsRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_system_settings_api_v1_system_settings__item_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                item_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SystemSettingsUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemSettingsRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    read_profile_api_v1_users_me_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserProfileRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_profile_api_v1_users_me_patch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserProfileUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserProfileRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    change_password_api_v1_users_me_password_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserPasswordChangeRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessageResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_users_api_v1_users_get: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
                /** @description Campos de orden separados por coma. Use '-' para orden descendente. */
                sort?: string;
                is_active?: boolean | null;
                email?: string | null;
                name?: string | null;
                id_in?: string[] | null;
                name_ne?: string | null;
                name_contains?: string | null;
                name_startswith?: string | null;
                name_endswith?: string | null;
                email_ne?: string | null;
                email_contains?: string | null;
                email_startswith?: string | null;
                email_endswith?: string | null;
                created_at_on?: string | null;
                created_at_before?: string | null;
                created_at_after?: string | null;
                created_at_from?: string | null;
                created_at_to?: string | null;
                q?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OffsetPage_UserAdminListItem_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_user_api_v1_users_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserAdminCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserAdminRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_user_api_v1_users__user_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                user_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserAdminRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_user_api_v1_users__user_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                user_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserAdminRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_user_api_v1_users__user_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                user_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserAdminUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserAdminRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_user_roles_api_v1_users__user_id__roles_get: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
                /** @description Campos de orden separados por coma. Use '-' para orden descendente. */
                sort?: string;
                is_active?: boolean | null;
                name?: string | null;
                id_in?: string[] | null;
                q?: string | null;
            };
            header?: never;
            path: {
                user_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OffsetPage_RoleRead_"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    replace_user_roles_api_v1_users__user_id__roles_put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                user_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserRolesReplace"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoleRead"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    revoke_user_sessions_api_v1_users__user_id__revoke_sessions_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                user_id: string;
            };
            cookie?: {
                session_token?: string | null;
            };
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserAdminRead"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
}
