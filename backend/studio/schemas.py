from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator
import math


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class ProjectCreate(Strict):
    name: str = Field(min_length=1, max_length=120)
    sources: list[str] = Field(min_length=1, max_length=20)
    sample: str | None = None
    music: str | None = None
    count: int = Field(default=3, ge=1, le=50)
    duration: float = Field(default=30, ge=3, le=180)
    lang: str = "en"
    notes: str = Field(default="", max_length=20000)
    preset: Literal["clean", "bold", "minimal"] = "clean"
    encoder: Literal["auto", "cpu", "nvenc"] = "auto"


class Segment(Strict):
    src: str = Field(min_length=1, max_length=40)
    sentences: list[int] | None = None
    s: float | None = Field(default=None, ge=0)
    e: float | None = Field(default=None, gt=0)
    meta: dict | None = None


class EditPatch(Strict):
    title: str | None = Field(default=None, max_length=150)
    title_text: str | None = Field(default=None, max_length=120)
    cta: str | None = Field(default=None, max_length=120)
    caption_text: dict[str, str] | None = None
    emphasis: list[str] | None = Field(default=None, max_length=30)
    segments: list[Segment] | None = Field(default=None, min_length=1, max_length=80)
    editing: dict | None = None  # Validated by the pipeline's single authoritative contract.

    @field_validator("caption_text")
    @classmethod
    def bounded_captions(cls, value):
        if value and (len(value) > 200 or any(len(text) > 1000 for text in value.values())):
            raise ValueError("Use at most 200 caption corrections of up to 1000 characters each.")
        return value


class EditRequest(Strict):
    generation: int = Field(ge=1)
    revision: int = Field(ge=0)
    changes: EditPatch


class MusicRequest(Strict):
    upload_id: str
    generation: int = Field(ge=1)
    revision: int = Field(ge=0)


class Decision(Strict):
    need_id: str
    revision: int = Field(ge=0)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    notes: str = Field(default="", max_length=4000)


class NeedDecision(Strict):
    need_id: str
    revision: int = Field(ge=0)


class CommentCreate(Strict):
    reel_id: str
    generation: int = Field(ge=1)
    time: float = Field(ge=0)
    text: str = Field(min_length=1, max_length=4000)


class Instruction(Strict):
    reel_id: str
    generation: int = Field(ge=1)
    text: str = Field(min_length=1, max_length=4000)


class ReviewDecision(NeedDecision):
    results: list[dict] = Field(min_length=1, max_length=100)


class UrlImport(Strict):
    url: str = Field(min_length=8, max_length=2048)
    role: Literal["source", "sample", "music"] = "source"
