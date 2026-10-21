import asyncio
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
import hashlib
import hmac
import importlib
import json
import mimetypes
from pathlib import Path
import secrets
import tempfile
import time
from urllib.parse import urlsplit
import zipfile
import httpx

from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import Settings
from .storage import Store
from .bridge import Pipeline, Conflict, merge
from . import planning
from .schemas import (ProjectCreate, EditRequest, Decision, NeedDecision, CommentCreate,
                      Instruction, ReviewDecision, UrlImport, MusicRequest)


class Login(BaseModel):
    token: str = Field(max_length=1000)


def create_app(settings=None):
    settings = settings or Settings.load()
    db = Store(settings.root)
    try:
        pipeline, setup_error = Pipeline(settings, db), None
    except (Exception, SystemExit) as e:
        pipeline, setup_error = None, str(e)
    for old in db.list("task"):
        if old["status"] in ("queued", "running"):
            db.put("task", old["id"], {**old, "status": "failed", "error": "Server restarted. Retry this action safely."})

    async def coordinate():
        while True:
            if pipeline:
                await asyncio.to_thread(pipeline.tick)
            await asyncio.sleep(2)

    @asynccontextmanager
    async def lifespan(_app):
        pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="studio-task")
        _app.state.pool = pool
        coordinator = asyncio.create_task(coordinate())
        yield
        coordinator.cancel()
        try:
            await coordinator
        except asyncio.CancelledError:
            pass
        pool.shutdown(wait=False, cancel_futures=True)

    app = FastAPI(title="Reel Studio", version="0.1.0", lifespan=lifespan)
    import os
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=os.environ.get(
        "STUDIO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1],testserver").split(","))
    app.state.pipeline, app.state.db, app.state.settings = pipeline, db, settings
    session = hmac.new(settings.token.encode(), b"reel-studio-session-v1", hashlib.sha256).hexdigest()

    @app.middleware("http")
    async def access(request, call_next):
        # Same-origin API + HttpOnly session cookies permit native video range requests.
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            allowed = {str(request.base_url).rstrip("/"), "http://127.0.0.1:5173", "http://localhost:5173"}
            if origin and origin not in allowed:
                return JSONResponse({"error": "Cross-origin changes are not allowed."}, status_code=403)
            length = request.headers.get("content-length", "")
            if request.url.path == "/api/uploads" and length.isdigit() and int(length) > settings.max_upload_bytes + 1024*1024:
                return JSONResponse({"error": "This file exceeds the configured upload limit."}, status_code=413)
        public = request.url.path in ("/api/health", "/api/session")
        if settings.token and request.url.path.startswith("/api/") and not public:
            cookie = request.cookies.get("studio_session", "")
            bearer = request.headers.get("authorization", "").removeprefix("Bearer ")
            if not (secrets.compare_digest(cookie, session) or secrets.compare_digest(bearer, settings.token)):
                return JSONResponse({"error": "Sign in to your Studio."}, status_code=401)
        result = await call_next(request)
        result.headers["X-Content-Type-Options"] = "nosniff"
        result.headers["Referrer-Policy"] = "same-origin"
        result.headers["Content-Security-Policy"] = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self'; "
            "frame-ancestors 'none'; object-src 'none'; base-uri 'self'")
        if request.url.path.startswith("/api/"):
            result.headers["Cache-Control"] = "no-store"
        return result

    @app.exception_handler(Conflict)
    async def conflict(_r, e):
        return JSONResponse({"error": str(e)}, status_code=409)

    @app.exception_handler(ValueError)
    async def invalid(_r, e):
        return JSONResponse({"error": str(e)}, status_code=422)

    if pipeline:
        @app.exception_handler(pipeline.o.JobError)
        async def job_error(_r, e):
            return JSONResponse({"error": str(e), "code": e.code, "details": e.errors},
                                status_code=404 if e.code == "no_job" else 409)

    def runtime():
        if not pipeline:
            raise HTTPException(503, setup_error or "The pipeline is not configured.")
        return pipeline

    def enqueue(action, job, fn):
        key = db.task(action, job)
        def work():
            record = db.get("task", key)
            db.put("task", key, {**record, "status": "running"})
            try:
                result = fn()
                db.put("task", key, {**record, "status": "succeeded", "result": result, "ended": time.time()})
            except Exception as e:
                db.put("task", key, {**record, "status": "failed", "error": str(e)[:4000], "ended": time.time()})
        app.state.pool.submit(work)
        return {"task_id": key}

    def start(jid):
        return enqueue("start", jid, lambda: runtime().start(jid))

    @app.get("/api/health")
    def health():
        return {"ok": True, "pipeline": pipeline is not None, "setup_error": setup_error,
                "authentication": bool(settings.token)}

    @app.post("/api/session")
    def login(body: Login, request: Request):
        if settings.token and not secrets.compare_digest(body.token, settings.token):
            raise HTTPException(401, "Incorrect Studio access key.")
        response = JSONResponse({"ok": True})
        response.set_cookie("studio_session", session, httponly=True, samesite="strict",
                            secure=request.url.scheme == "https", max_age=12*3600)
        return response

    @app.delete("/api/session")
    def logout():
        result = JSONResponse({"ok": True})
        result.delete_cookie("studio_session")
        return result

    @app.get("/api/config")
    def config():
        p = runtime()
        ready = importlib.import_module("reelkit.readiness")
        # Shallow checks only; no model loads or encoder smoke runs before approval.
        return {"ai_enabled": bool(settings.ai_key), "fonts": planning.FONTS,
                "presets": ["clean", "bold", "minimal"], "max_upload_bytes": settings.max_upload_bytes,
                "pipeline_policy": p.o.POLICY["version"], "storyboard_limits": p.o.POLICY["storyboard"]}

    @app.get("/api/projects")
    def projects():
        return runtime().list()

    @app.get("/api/projects/{jid}")
    def project(jid: str):
        return runtime().detail(jid)

    @app.post("/api/projects", status_code=201)
    def create(body: ProjectCreate):
        p = runtime()
        jid = p.create(body)
        task = start(jid)
        return {"id": jid, **task}

    @app.post("/api/projects/{jid}/start", status_code=202)
    def resume(jid: str):
        runtime().job(jid)
        return start(jid)

    @app.post("/api/projects/{jid}/cancel", status_code=202)
    def cancel(jid: str):
        runtime().job(jid)
        return enqueue("cancel", jid, lambda: runtime().o.cancel(jid))

    @app.post("/api/projects/{jid}/retry", status_code=202)
    def retry(jid: str):
        runtime().o.retry(jid)
        return start(jid)

    @app.post("/api/projects/{jid}/plan", status_code=202)
    def suggest(jid: str, body: NeedDecision):
        runtime().plan(jid, body)
        return start(jid)

    @app.post("/api/projects/{jid}/verify-style", status_code=202)
    def verify(jid: str, body: NeedDecision):
        runtime().verify(jid, body)
        return start(jid)

    @app.patch("/api/projects/{jid}/reels/{rid}", status_code=202)
    def edit(jid: str, rid: str, body: EditRequest):
        runtime().edit(jid, rid, body)
        return start(jid)

    @app.post("/api/projects/{jid}/undo", status_code=202)
    def undo(jid: str, body: EditRequest):
        runtime().undo(jid, body.generation, body.revision)
        return start(jid)

    @app.post("/api/projects/{jid}/music", status_code=202)
    def set_music(jid: str, body: MusicRequest):
        runtime().set_music(jid, body)
        return start(jid)

    @app.post("/api/projects/{jid}/approve", status_code=202)
    def approve(jid: str, body: Decision):
        runtime().decision(jid, "approve", body)
        return start(jid)

    @app.post("/api/projects/{jid}/revise", status_code=202)
    def revise(jid: str, body: Decision):
        runtime().decision(jid, "revise", body)
        # User feedback needs a planner; no automatic rewrite or approval.
        return start(jid)

    @app.post("/api/projects/{jid}/review", status_code=202)
    def review(jid: str, body: ReviewDecision):
        runtime().review(jid, body)
        return start(jid)

    @app.post("/api/projects/{jid}/duplicate", status_code=201)
    def duplicate(jid: str):
        p = runtime()
        old = p.job(jid)
        if old.get("plan"):
            p.require_transcripts(old, p.fs.read_json(old["plan"]["path"]))
        roles = {role: [p.assets.get(a).path for a in old["inputs"][plural]] for role, plural in p.o.ROLES.items()}
        rq = p.o._rq(old)
        new = p.o.create(roles=roles, count=rq.get("count"), duration=rq.get("duration_seconds"),
                         notes=rq.get("notes"), lang=rq.get("lang"))
        meta = db.get("project", jid) or {}
        db.put("project", new["id"], {"id": new["id"], "name": meta.get("name", jid) + " (copy)",
                                      "auto_plan": True, "demo": meta.get("demo", False)})
        if old.get("plan") and old.get("style_version"):
            context = p.o._context(new, "intake")
            result = p.o._w_intake(context)
            with p.o._txn(new["id"]) as job:
                p.o._c_intake(job, context, result)
                style = p.fs.read_json(old["style_version"]["path"])
                p.o._publish_style(job, style, job["inputs"]["samples"][0], old["style_version"]["fingerprint"], "copied project style")
                job["steps"]["analyze"] = {"done": True, "key": p.o._key(job, "analyze")}
                # Sources share asset IDs. Re-pin the old plan to the new job and style.
                errors, prep = p.o._check_plan(job, p.fs.read_json(old["plan"]["path"]), None)
                if errors:
                    raise ValueError("\n".join(errors))
                p.o._accept_plan(job, prep, "studio-duplicate", "copied project plan")
        return {"id": new["id"], **start(new["id"])}

    @app.post("/api/projects/{jid}/propose")
    def propose(jid: str, body: Instruction):
        p = runtime()
        job = p.job(jid)
        if job["plan_generation"] != body.generation:
            raise Conflict("This plan changed. Refresh before asking for an edit.")
        plan = p.fs.read_json(job["plan"]["path"])
        p.require_transcripts(job, plan)
        reel = next((r for r in plan["reels"] if r["id"] == body.reel_id), None)
        if not reel:
            raise HTTPException(404, "Reel not found.")
        context = {k: reel[k] for k in ("id", "title", "title_text", "cta", "segments", "hook", "emphasis", "editing") if k in reel}
        context["caption_text"] = {k: v[:500] for k, v in list((reel.get("caption_text") or {}).items())[:30]}
        context["source_sentences"] = {}
        remaining = 16000
        lang = p.o._lang(job)
        for seg in ([reel["hook"]] if reel.get("hook") else []) + reel.get("segments", []):
            src = seg["src"]
            tr = p.fs.read_json(p.assets.get(plan["sources"][src]).cache(f"transcript.{lang}.json")) or {}
            sents = tr.get("sentences", [])
            if seg.get("sentences"):
                first, last = seg["sentences"][0], seg["sentences"][-1]
                chosen = sents[max(0, first-3):min(len(sents), last+4)]
            else:
                chosen = [s for s in sents if s["e"] >= seg.get("s", 0)-5 and s["s"] <= seg.get("e", 0)+5]
            for sentence in chosen[:60]:
                length = len(sentence["text"]) + 100
                if length > remaining:
                    break
                remaining -= length
                context["source_sentences"].setdefault(src, []).append(sentence)
        try:
            result = planning.propose(body.text, context, settings)
        except httpx.HTTPError as e:
            status = e.response.status_code if isinstance(e, httpx.HTTPStatusError) else "connection error"
            raise HTTPException(502, f"The AI provider could not complete this request ({status}). No changes were applied.") from e
        candidate = json.loads(json.dumps(plan))
        at = next(i for i, r in enumerate(candidate["reels"]) if r["id"] == body.reel_id)
        candidate["reels"][at] = merge(reel, result["changes"])
        errors, _ = p.o._check_plan(job, candidate, job.get("repair"))
        if errors:
            raise ValueError("The suggested changes are invalid: " + "\n".join(errors))
        return {**result, "generation": body.generation}

    @app.post("/api/projects/{jid}/comments", status_code=201)
    def comment(jid: str, body: CommentCreate):
        p = runtime()
        job = p.job(jid)
        if body.generation != job["plan_generation"]:
            raise Conflict("This storyboard changed. Refresh before leaving feedback.")
        plan = p.fs.read_json(job["plan"]["path"])
        if body.reel_id not in {r["id"] for r in plan["reels"]}:
            raise ValueError("Unknown reel.")
        board = p.fs.read_json((job.get("storyboard") or {}).get("manifest", "")) or {}
        reel = next((r for r in board.get("reels", []) if r["id"] == body.reel_id), None)
        if reel and body.time > reel["duration"] + .1:
            raise ValueError("The comment timestamp is past the end of the reel.")
        record = {**body.model_dump(), "id": secrets.token_hex(12), "job_id": jid, "resolved": False, "at": time.time()}
        return db.put("comment", record["id"], record)

    @app.patch("/api/projects/{jid}/comments/{cid}")
    def resolve_comment(jid: str, cid: str, body: dict):
        runtime().job(jid)
        record = db.get("comment", cid)
        if not record or record["job_id"] != jid:
            raise HTTPException(404, "Comment not found.")
        if set(body) != {"resolved"} or not isinstance(body["resolved"], bool):
            raise ValueError("Expected resolved: true or false.")
        return db.put("comment", cid, {**record, "resolved": body["resolved"]})

    @app.get("/api/tasks/{key}")
    def task(key: str):
        result = db.get("task", key)
        if not result:
            raise HTTPException(404, "Task not found.")
        return result

    @app.get("/api/uploads")
    def uploads():
        return [{k: x[k] for k in ("id", "name", "role", "bytes")} for x in db.list("upload")]

    @app.get("/api/fonts/{family}")
    def font(family: str, weight: int = 700):
        runtime()
        if family not in planning.FONTS or weight not in range(100, 1000, 100):
            raise HTTPException(404, "Font not available.")
        captions = importlib.import_module("reelkit.captions")
        return FileResponse(captions.font_file(family, weight), media_type="font/ttf")

    @app.post("/api/uploads", status_code=201)
    async def upload(file: UploadFile = File(...), role: str = Form("source")):
        p = runtime()
        if role not in ("source", "sample", "music"):
            raise HTTPException(422, "Choose source, sample or music.")
        ext = Path(file.filename or "video.mp4").suffix.lower()
        if ext not in (".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi", ".mp3", ".wav", ".m4a", ".flac", ".ogg", ".opus"):
            raise HTTPException(422, "Choose a supported video or audio file.")
        staging = settings.root / "uploads"
        staging.mkdir(exist_ok=True)
        path = staging / (secrets.token_hex(16) + ext)
        total = 0
        try:
            with path.open("wb") as out:
                while chunk := await file.read(1024 * 1024):
                    total += len(chunk)
                    if total > settings.max_upload_bytes:
                        raise HTTPException(413, "This file exceeds the configured upload limit.")
                    out.write(chunk)
            try:
                asset = await asyncio.to_thread(p.assets.ingest, path, role)
            except Exception as e:
                raise HTTPException(422, "This file could not be read as media. Check that it is a complete video or audio file.") from e
            if role in ("source", "sample") and not asset.info.get("width"):
                raise HTTPException(422, "This role needs a video file.")
            key = secrets.token_hex(16)
            record = {"id": key, "name": Path(file.filename or "Upload").name, "role": role, "asset": asset.id, "bytes": total}
            db.put("upload", key, record)
            return {k: record[k] for k in ("id", "name", "role", "bytes")}
        finally:
            path.unlink(missing_ok=True)
            await file.close()

    @app.post("/api/imports", status_code=202)
    def import_url(body: UrlImport):
        p = runtime()
        url = urlsplit(body.url)
        hosts = ("youtube.com", "youtu.be", "vimeo.com", "tiktok.com", "instagram.com", "x.com", "twitter.com")
        host = (url.hostname or "").lower()
        if url.scheme != "https" or url.username or not any(host == h or host.endswith("." + h) for h in hosts):
            raise ValueError("Use an HTTPS video URL from YouTube, Vimeo, TikTok, Instagram or X.")
        def download():
            asset = importlib.import_module("reelkit.download").ingest_url(body.url, body.role, max_bytes=settings.max_upload_bytes)
            if asset.path.stat().st_size > settings.max_upload_bytes:
                raise ValueError("The downloaded media exceeds the configured upload limit.")
            key = secrets.token_hex(16)
            provenance = p.fs.read_json(asset.cache("import.json")) or {}
            record = {"id": key, "name": provenance.get("title") or asset.meta["name"], "role": body.role,
                      "asset": asset.id, "bytes": asset.path.stat().st_size}
            db.put("upload", key, record)
            return {k: record[k] for k in ("id", "name", "role", "bytes")}
        return enqueue("import", None, download)

    @app.api_route("/api/media/{key}", methods=["GET", "HEAD"])
    def media(key: str, download: bool = False):
        runtime()
        record = db.artifact(key)
        if not record:
            raise HTTPException(404, "Media not found.")
        path = Path(record["path"]).resolve()
        if not path.is_relative_to(settings.data) or not path.is_file():
            raise HTTPException(404, "Media not found.")
        return FileResponse(path, media_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream",
                            filename=record["name"] if download else None,
                            content_disposition_type="attachment" if download else "inline")

    @app.get("/api/projects/{jid}/export")
    def export(jid: str):
        p = runtime()
        job = p.job(jid)
        files = (job.get("deliver") or {}).get("files") or []
        if not files:
            raise Conflict("No accepted deliverables yet. Approve the storyboard, render and finish the render review first.")
        allowed = {d["file"]: d["sha256"] for d in (p.o._manifest(job) or {}).get("deliverables", [])}
        for item in files:
            path = Path(item).resolve()
            if not path.is_relative_to(settings.data) or p.fs.sha256_file(path) != allowed.get(item):
                raise Conflict("A deliverable changed on disk. Revalidate the render before exporting.")
        dest = settings.root / f"export-{secrets.token_hex(12)}.zip"
        with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_STORED) as archive:
            for item in files:
                archive.write(item, Path(item).name)
        return FileResponse(dest, filename=f"{jid}.zip", media_type="application/zip",
                            background=BackgroundTask(dest.unlink, missing_ok=True))

    dist = Path(__file__).resolve().parents[2] / "frontend/dist"
    # Source checkout: backend/studio -> backend -> repo; bundled installation uses STUDIO_FRONTEND_DIR.
    import os
    dist = Path(os.environ.get("STUDIO_FRONTEND_DIR", str(dist)))
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
    else:
        @app.get("/")
        def setup_page():
            return JSONResponse({"message": "Build the frontend with cd frontend && npm ci && npm run build.", "api": "/docs"})
    return app
