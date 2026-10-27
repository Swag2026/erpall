from pydantic import BaseModel
from typing import Optional


class SettingUpdate(BaseModel):
    key: str
    value: str


class SettingResponse(BaseModel):
    key: str
    value: Optional[str]

    model_config = {"from_attributes": True}


class BulkSettingsUpdate(BaseModel):
    settings: dict
