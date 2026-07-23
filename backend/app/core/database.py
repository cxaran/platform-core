# app/core/database.py

from typing import Annotated
from fastapi.params import Depends
from sqlmodel import Session, create_engine
from collections.abc import Generator

from .settings import settings

engine = create_engine(
    str(settings.postgres_dsn),
    connect_args={"options": "-c timezone=utc"},
)

def get_db() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_db)]
