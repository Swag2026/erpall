from pydantic import BaseModel, field_validator


class SalesmanCreate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def _clean(cls, v: str) -> str:
        v = " ".join((v or "").split())
        if not v:
            raise ValueError("Name is required")
        if len(v) > 150:
            raise ValueError("Name is too long")
        return v


class SalesmanResponse(BaseModel):
    id: int
    name: str
    is_active: bool

    model_config = {"from_attributes": True}
