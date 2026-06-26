"""Tests del contrato HTTP de errores: envelope unico con code, message, errors.

Verifica que QueryParameterError y RequestValidationError produzcan respuestas
422 con la estructura normalizada, sin depender del texto exacto de los mensajes
de Pydantic (que puede variar entre versiones).
"""

import unittest

from fastapi import FastAPI, Query
from fastapi.testclient import TestClient

from backend.app.core.error_handlers import (
    _spanish_validation_message,
    register_exception_handlers,
)
from backend.app.query.validation import QueryParameterError


def _build_app() -> FastAPI:
    app = FastAPI()

    @app.get("/raise-query-param-error")
    def _raise_query_param_error() -> None:
        raise QueryParameterError(
            "unsupported_sort_field",
            "No se permite ordenar por 'bad_field'.",
            field_name="sort",
        )

    @app.get("/validation-error")
    def _validation_error(limit: int = Query(ge=1)) -> None:
        _ = limit

    register_exception_handlers(app)
    return app


class QueryParameterErrorContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(_build_app())

    def test_returns_422_with_code_message_and_errors(self) -> None:
        response = self.client.get("/raise-query-param-error")

        self.assertEqual(response.status_code, 422)

        body = response.json()
        self.assertEqual(body["code"], "unsupported_sort_field")
        self.assertTrue(body["message"])

        errors = body.get("errors")
        self.assertIsNotNone(errors)
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0]["field"], "sort")
        self.assertTrue(errors[0]["message"])


class RequestValidationErrorContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(_build_app())

    def test_query_param_below_minimum_returns_422_with_normalized_field(self) -> None:
        response = self.client.get("/validation-error?limit=0")

        self.assertEqual(response.status_code, 422)

        body = response.json()
        self.assertEqual(body["code"], "validation_error")
        self.assertTrue(body["message"])

        errors = body.get("errors")
        self.assertIsNotNone(errors)
        self.assertEqual(len(errors), 1)

        field = errors[0]["field"]
        self.assertEqual(field, "limit")
        self.assertTrue(errors[0]["message"])

    def test_missing_required_query_param_returns_422_with_field(self) -> None:
        response = self.client.get("/validation-error")

        self.assertEqual(response.status_code, 422)

        body = response.json()
        self.assertEqual(body["code"], "validation_error")

        errors = body.get("errors")
        self.assertIsNotNone(errors)

        field = errors[0]["field"]
        self.assertEqual(field, "limit")


class SpanishValidationMessageTest(unittest.TestCase):
    def test_string_too_short_uses_declared_minimum(self) -> None:
        message = _spanish_validation_message(
            {"type": "string_too_short", "ctx": {"min_length": 4}, "msg": "x"}
        )
        self.assertEqual(message, "Debe tener al menos 4 caracteres.")

    def test_string_too_long_uses_declared_maximum(self) -> None:
        message = _spanish_validation_message(
            {"type": "string_too_long", "ctx": {"max_length": 50}, "msg": "x"}
        )
        self.assertEqual(message, "Debe tener como máximo 50 caracteres.")

    def test_missing_field(self) -> None:
        self.assertEqual(
            _spanish_validation_message({"type": "missing", "msg": "Field required"}),
            "Este campo es obligatorio.",
        )

    def test_domain_value_error_is_preserved(self) -> None:
        # Mensaje de un validador de dominio (ya en español): se conserva.
        message = _spanish_validation_message(
            {"type": "value_error", "msg": "Value error, Las contraseñas no coinciden"}
        )
        self.assertEqual(message, "Las contraseñas no coinciden")

    def test_email_value_error_is_localized(self) -> None:
        message = _spanish_validation_message(
            {"type": "value_error", "msg": "value is not a valid email address: bad"}
        )
        self.assertEqual(message, "Correo electrónico inválido.")

    def test_unknown_type_uses_safe_general_message(self) -> None:
        message = _spanish_validation_message(
            {"type": "something_internal", "msg": "internal english detail"}
        )
        self.assertEqual(message, "El valor ingresado no es válido.")
        self.assertNotIn("english", message)


if __name__ == "__main__":
    unittest.main()
