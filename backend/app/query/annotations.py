"""Introspección de anotaciones compartida por el motor de query y projection.

Helpers puros (solo stdlib) usados por ``factory``, ``operators`` y
``resources/projection`` para razonar sobre los tipos públicos de los campos.
"""

from enum import Enum
from typing import Annotated, Any, get_args, get_origin


def unwrap_annotated(annotation: Any) -> Any:
    """Desenvuelve capas de ``Annotated[...]`` hasta el tipo base."""
    value = annotation
    while get_origin(value) is Annotated:
        value = get_args(value)[0]
    return value


def is_enum_type(field_type: Any) -> bool:
    """``True`` si el tipo público del campo es un ``Enum``."""
    return isinstance(field_type, type) and issubclass(field_type, Enum)
