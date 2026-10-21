from dataclasses import dataclass
import os
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    pipeline: Path
    data: Path
    root: Path
    token: str = ""
    max_upload_bytes: int = 4 * 1024**3
    ai_url: str = "https://api.openai.com/v1"
    ai_key: str = ""
    ai_model: str = "gpt-4.1-mini"

    @classmethod
    def load(cls):
        from dotenv import load_dotenv
        load_dotenv()
        root = Path(os.environ.get("STUDIO_ROOT", Path.cwd() / ".studio")).resolve()
        pipeline = Path(os.environ.get("REEL_PIPELINE_PATH", Path.cwd().parent / "DSprojects/reel-pipeline")).resolve()
        return cls(pipeline, Path(os.environ.get("REELKIT_DATA", pipeline / "data")).resolve(), root,
                   token=os.environ.get("STUDIO_TOKEN", ""),
                   max_upload_bytes=int(os.environ.get("STUDIO_MAX_UPLOAD_BYTES", 4 * 1024**3)),
                   ai_url=os.environ.get("STUDIO_AI_URL", "https://api.openai.com/v1").rstrip("/"),
                   ai_key=os.environ.get("OPENAI_API_KEY", ""),
                   ai_model=os.environ.get("STUDIO_AI_MODEL", "gpt-4.1-mini"))
