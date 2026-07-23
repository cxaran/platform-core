"""Tests del contrato HTTP de errores: envelope unico con code, message, errors.

Verifica que QueryParameterError y RequestValidationError produzcan respuestas
422 con la estructura normalizada, sin depender del texto exacto de los mensajes
de Pydantic (que puede variar entre versiones).
"""

import unittest

from fastapi import FastAPI, Query
from fastapi.testclient import TestClient

from backend.app.core.error_handlers import register_exception_handlers
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


class StructuredValidationErrorTest(unittest.TestCase):
    """Los items de validación exponen ``type`` y ``ctx`` estructurados: la
    traducción a mensajes UX vive en el frontend (validation-messages.ts)."""

    def setUp(self) -> None:
        self.client = TestClient(_build_app())

    def test_constraint_error_exposes_type_and_ctx(self) -> None:
        response = self.client.get("/validation-error?limit=0")

        error = response.json()["errors"][0]
        self.assertEqual(error["type"], "greater_than_equal")
        self.assertEqual(error["ctx"], {"ge": 1})
        self.assertTrue(error["message"])

    def test_missing_field_exposes_type_without_ctx(self) -> None:
        response = self.client.get("/validation-error")

        error = response.json()["errors"][0]
        self.assertEqual(error["type"], "missing")
        self.assertNotIn("ctx", error)

    def test_business_error_items_have_no_type(self) -> None:
        # Los errores de negocio (QueryParameterError) ya vienen en español y sin
        # metadata estructurada: el frontend debe usarlos tal cual.
        response = self.client.get("/raise-query-param-error")

        error = response.json()["errors"][0]
        self.assertNotIn("type", error)
        self.assertEqual(error["message"], "No se permite ordenar por 'bad_field'.")


if __name__ == "__main__":
    unittest.main()
