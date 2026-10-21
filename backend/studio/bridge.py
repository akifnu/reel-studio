"""The only boundary between the web application and the pinned reelkit runtime.

User mutations use reelkit's state lock and validation. Workers are always detached;
the web server never impersonates a foreground worker or bypasses storyboard consent.
"""
import copy
import importlib
import os
from pathlib import Path
import secrets
import sys
import time

from . import planning


def merge(base, patch):
    out = copy.deepcopy(base)
    for key, value in patch.items():
        out[key] = merge(out.get(key) or {}, value) if isinstance(value, dict) else copy.deepcopy(value)
    return out


class Conflict(ValueError):
    pass


class Pipeline:
    def __init__(self, settings, db):
        self.settings, self.db = settings, db
        if not (settings.pipeline / "reelkit/orchestrator.py").is_file():
            raise RuntimeError("Set REEL_PIPELINE_PATH to the DSprojects/reel-pipeline checkout. See README setup.")
        os.environ["REELKIT_DATA"] = str(settings.data)
        sys.path.insert(0, str(settings.pipeline))
        self.o = importlib.import_module("reelkit.orchestrator")
        self.assets = importlib.import_module("reelkit.store")
        self.fs = importlib.import_module("reelkit.fsutil")
        self.c = importlib.import_module("reelkit.contracts")
        self.compiler = importlib.import_module("reelkit.compile")
        self.asr = importlib.import_module("reelkit.asr")
        if Path(self.o.DATA).resolve() != settings.data:
            raise RuntimeError("The pipeline data directory changed in this process. Restart the server.")
        if "editing" not in self.c.REEL_KEYS:
            raise RuntimeError("This pipeline version lacks Studio editing controls. Update DSprojects as described in README.")

    def job(self, jid):
        return self.o._load(self.o.resolve(jid))

    def idle(self, job):
        if (self.o._attempt_info(job) or {}).get("running"):
            raise Conflict("The worker is still running. Wait or cancel before changing this project.")

    def current(self, job, generation, revision):
        self.idle(job)
        if job["terminal"]:
            raise Conflict("This project is finished. Duplicate it to make a new edit.")
        if job["plan_generation"] != generation or job["revision"] != revision:
            raise Conflict("This project changed in another tab. Refresh before applying your edit.")
        if job.get("plan"):
            self.require_transcripts(job, self.fs.read_json(job["plan"]["path"]))

    def require_transcripts(self, job, plan):
        lang, provider = self.o._lang(job), job["policy"]["asr_provider"]
        for aid in (plan.get("sources") or {}).values():
            a = self.assets.get(aid)
            if a.info.get("has_audio") and self.asr._cached(a.cache(f"transcript.{lang}.json"), lang, provider, quiet=True) is None:
                raise Conflict("A cached transcript changed or is missing. Resume the worker to refresh it before editing; for a completed job, create a new project.")

    def url(self, jid, path, name=None):
        if not path or not Path(path).is_file():
            return None
        p = Path(path).resolve()
        if not p.is_relative_to(self.settings.data):
            return None
        return self.db.media(jid, p, name)

    def list(self):
        result = []
        for job in reversed(self.o.list_jobs()):
            meta = self.db.get("project", job["id"]) or {}
            result.append({**job, "name": meta.get("name", job["id"]), "demo": meta.get("demo", False)})
        return result

    def detail(self, jid):
        job = self.job(jid)
        meta = self.db.get("project", jid) or {}
        plan = self.fs.read_json((job.get("plan") or {}).get("path", "")) or {}
        style = self.fs.read_json((job.get("style_version") or {}).get("path", "")) or {}
        if not style and (job.get("needs") or {}).get("step") == "verify_style":
            style = self.fs.read_json(job["needs"]["style"]) or {}
        board = job.get("storyboard") or {}
        bm = self.fs.read_json(board.get("manifest", "")) or {}
        boards = {r["id"]: r for r in bm.get("reels") or []}
        manifest = self.o._manifest(job) or {}
        renders = {r["id"]: r for r in manifest.get("reels") or []}
        reels = []
        for r in plan.get("reels") or []:
            b, output = boards.get(r["id"], {}), renders.get(r["id"], {})
            timeline = self.fs.read_json(b.get("timeline", "")) or {}
            effective = self.compiler.reel_style(style, r)
            reels.append({**r, "duration": b.get("duration"), "speech": b.get("speech", ""),
                          "shot_list": b.get("shot_list", []),
                          "frames": [{"t": f["t"], "url": self.url(jid, f["file"])} for f in b.get("frames", [])],
                          "gif": {**{k: v for k, v in (b.get("gif") or {}).items() if k != "file"},
                                  "url": self.url(jid, (b.get("gif") or {}).get("file"))},
                          "caption_events": timeline.get("captions", []), "text_events": timeline.get("text", []),
                          "effective_style": effective,
                          "render": {"url": self.url(jid, output.get("file")), "status": output.get("status"),
                                     "qc_verdict": output.get("qc_verdict"), "issues": output.get("issues", []),
                                     "sha256": output.get("render_sha256"), "error": output.get("error")}})
        sources, transcripts = {}, {}
        labels = {u["asset"]: u["name"] for u in self.db.list("upload")}
        lang = self.compiler._lang(plan, style) if plan else self.o._lang(job)
        source_map = plan.get("sources") or {chr(65 + i): aid for i, aid in enumerate(job["inputs"]["sources"])}
        for key, aid in source_map.items():
            a = self.assets.get(aid)
            sources[key] = {"id": aid, "name": meta.get("source_names", {}).get(aid, labels.get(aid, a.meta.get("name"))), "url": self.url(jid, a.path),
                            "width": a.info.get("width"), "height": a.info.get("height"), "duration": a.info.get("duration")}
            tr = self.fs.read_json(a.cache(f"transcript.{lang}.json")) or {}
            transcripts[key] = {"sentences": tr.get("sentences", []), "timing": tr.get("timing"), "lang": tr.get("lang")}
        need = copy.deepcopy(job.get("needs"))
        if need:
            # Clients see opaque media URLs, never filesystem paths or result-file destinations.
            keep = ("step", "need_id", "revision", "storyboard_sha256", "errors", "limitations", "plan_generation",
                    "count", "target_duration", "notes", "fixes", "only", "storyboard_feedback", "assigned")
            need = {k: need[k] for k in keep if k in need}
            if "assigned" in need:
                need["assigned"] = [{k: a.get(k) for k in ("id", "render_sha256", "qc_verdict", "issues", "error")}
                                    for a in need["assigned"]]
        sample = self.assets.get(job["inputs"]["samples"][0]) if job["inputs"]["samples"] else None
        music = self.assets.get(job["inputs"]["music"][0]) if job["inputs"]["music"] else None
        return {"id": jid, "name": meta.get("name", jid), "demo": meta.get("demo", False), "status": job["status"],
                "revision": job["revision"], "generation": job["plan_generation"], "terminal": job["terminal"],
                "busy": bool((self.o._attempt_info(job) or {}).get("running")), "needs": need,
                "reels": reels, "style": style, "sources": sources, "transcripts": transcripts,
                "reference": {"id": sample.id, "name": meta.get("reference_name") or labels.get(sample.id, sample.meta.get("name", sample.path.name)),
                              "notes": meta.get("reference_notes", ""), "mode": "analyzed"}
                             if sample and meta.get("reference_id") else None,
                "sample_url": self.url(jid, sample.path) if sample else None,
                "sample_review_url": self.url(jid, sample.cache("review.jpg")) if sample else None,
                "music_url": self.url(jid, music.path) if music else None,
                "storyboard": {"frames": board.get("frames", 0), "gif_frames": board.get("gif_frames", 0),
                               "elapsed_s": board.get("elapsed_s"), "cache_hits": board.get("cache_hits", 0),
                               "estimated_render_frames": board.get("estimated_render_frames", 0),
                               "limits": job["policy"]["storyboard"], "limitations": board.get("limitations"),
                               "sheet_url": self.url(jid, board.get("sheet"))},
                "comments": [x for x in self.db.list("comment") if x["job_id"] == jid],
                "history": [{k: x[k] for k in ("id", "at", "description", "generation")} for x in self.db.list("edit") if x["job_id"] == jid],
                "activity": job.get("log", [])[-12:], "error": {"cause": (job.get("error") or {}).get("cause")} if job.get("error") else None,
                "counts": (job.get("deliver") or {}).get("counts") or (job.get("render") or {}).get("counts"),
                "deliverables": [{"name": Path(p).name, "url": self.url(jid, p)} for p in (job.get("deliver") or {}).get("files", [])]}

    def preset(self, asset, name):
        style = {"version": 2, "sample": {"id": asset.id, "name": f"{name} preset", "width": 720, "height": 1280,
                                        "duration": 30, "fps": 30},
                 "pacing": {"median_shot": 2.5, "max_pause": .35}, "motion": {"punch_scales": [1, 1.12], "punch_rate": .3},
                 "transitions": {}, "grade": {}, "audio": {"loudness": {"I": -14}, "music": {"duck_db": 12}},
                 "captions": {"present": True, "words_per_caption": {"median": 3, "max": 5},
                              "style": {"font": "Arimo", "weight": 700, "size": 56, "y": 280, "fill": "#ffffff",
                                        "stroke": {"color": "#000000", "width": 3}, "anim": {"in": "pop", "in_dur": .12}}}}
        if name == "bold":
            style["captions"]["style"].update(font="Anton", size=68, case="upper", fill="#ffe600")
        if name == "minimal":
            style["captions"]["style"].update(size=44, weight=400, anim={"in": "fade", "in_dur": .12})
            style["motion"] = {"punch_scales": [1]}
        return style

    def create(self, request):
        uploads = {}
        selections = [(key, "source") for key in request.sources]
        selections += [(request.sample, "sample")] if request.sample else []
        selections += [(request.music, "music")] if request.music else []
        for key, role in selections:
            record = self.db.get("upload", key)
            if not record:
                raise ValueError("An uploaded file is missing. Upload it again before creating the project.")
            if record["role"] != role:
                raise ValueError("Keep reference reels, raw footage and background music in their respective inputs.")
            uploads[key] = self.assets.get(record["asset"])
        sources = [uploads[x] for x in request.sources]
        demo = any((self.fs.read_json(path) or {}).get("demo") is True for a in sources for path in a.dir.glob("transcript.*.json"))
        if any(not a.info.get("width") for a in sources):
            raise ValueError("Source files must contain video.")
        if request.sample and not uploads[request.sample].info.get("width"):
            raise ValueError("The reference must contain video.")
        sample = uploads[request.sample] if request.sample else sources[0]
        roles = {"source": [a.path for a in sources], "sample": [sample.path]}
        if request.music:
            roles["music"] = [uploads[request.music].path]
        job = self.o.create(roles=roles, count=request.count, duration=request.duration, lang=request.lang,
                            notes="\n\n".join(x for x in (request.notes, "Reference style brief: " + request.reference_notes if request.sample and request.reference_notes else "") if x), execution={"encoder": request.encoder})
        jid = job["id"]
        self.db.put("project", jid, {"id": jid, "name": request.name, "auto_plan": True, "created": time.time(), "demo": demo,
                                     "reference_id": request.sample, "reference_notes": request.reference_notes if request.sample else "",
                                     "reference_name": self.db.get("upload", request.sample)["name"] if request.sample else None,
                                     "source_names": {uploads[key].id: self.db.get("upload", key)["name"] for key in request.sources}})
        # Uploaded media is already in the verified asset store. Finish ingest normally.
        context = self.o._context(job, "intake")
        ingested = self.o._w_intake(context)
        with self.o._txn(jid) as current:
            self.o._c_intake(current, context, ingested)
            if not request.sample:
                self.o._publish_style(current, self.preset(sample, request.preset), sample.id,
                                      f"studio-preset:{request.preset}", "user selected preset")
                current["steps"]["analyze"] = {"done": True, "key": self.o._key(current, "analyze")}
        return jid

    def start(self, jid):
        job = self.job(jid)
        if not job["terminal"] and not (self.o._attempt_info(job) or {}).get("running"):
            lang, provider = self.o._lang(job), job["policy"]["asr_provider"]
            stale = any(a.info.get("has_audio") and self.asr._cached(a.cache(f"transcript.{lang}.json"), lang, provider, quiet=True) is None
                        for a in (self.assets.get(aid) for aid in job["inputs"]["sources"]))
            if stale:
                with self.o._txn(jid) as current:
                    if not (self.o._attempt_info(current) or {}).get("running"):
                        current["steps"].pop("transcribe", None)
                        current["storyboard_approval"] = None
                        current["steps"].pop("approve_storyboard", None)
                        if current.get("plan"):
                            current["steps"]["plan"]["reopened"] = True
                        if (current.get("needs") or {}).get("step") in ("plan", "approve_storyboard", "review"):
                            current["needs"], current["status"] = None, "waiting:worker"
        return self.o.start(jid)

    def plan(self, jid, expected=None):
        job = self.job(jid)
        self.idle(job)
        n = job.get("needs") or {}
        if n.get("step") != "plan":
            raise Conflict("This project is not waiting for a plan.")
        if expected and (n["need_id"] != expected.need_id or n["revision"] != expected.revision):
            raise Conflict("The planning request changed. Refresh and try again.")
        plan = self.fs.read_json(n["plan"])
        self.require_transcripts(job, plan)
        lang = self.o._lang(job)
        transcripts = {k: self.fs.read_json(self.assets.get(aid).cache(f"transcript.{lang}.json")) or {}
                       for k, aid in plan["sources"].items()}
        rq = self.o._rq(job)
        result = planning.suggest(plan, transcripts, rq.get("count") or 3, rq.get("duration_seconds") or 30)
        path = self.o._dir(jid) / "inbox" / f"{n['need_id']}.studio-plan.json"
        self.fs.atomic_write_json(path, result)
        self.o.complete(jid, "plan", need_id=n["need_id"], revision=n["revision"], result_file=str(path),
                        note="Local suggestions from complete transcript sentences; review the storyboard")
        meta = self.db.get("project", jid) or {"id": jid}
        self.db.put("project", jid, {**meta, "auto_plan": False})

    def edit(self, jid, rid, request, description="Updated reel controls"):
        before = None
        with self.o._txn(jid) as job:
            self.current(job, request.generation, request.revision)
            before = self.fs.read_json(job["plan"]["path"])
            plan = copy.deepcopy(before)
            reel = next((r for r in plan["reels"] if r["id"] == rid), None)
            if not reel:
                raise ValueError("Reel not found.")
            changes = request.changes.model_dump(exclude_none=True)
            new = merge(reel, changes)
            # The inherited hook is separately ordered. Explicit segment edits replace it.
            if "segments" in changes:
                new.pop("hook", None)
            reel.clear()
            reel.update(new)
            errors, prep = self.o._check_plan(job, plan, job.get("repair"))
            if errors:
                raise ValueError("\n".join(errors))
            self.o._accept_plan(job, prep, "studio-user-edit", description)
            job["needs"], job["status"] = None, "waiting:worker"
            generation = job["plan_generation"]
        key = secrets.token_hex(12)
        self.db.put("edit", key, {"id": key, "job_id": jid, "reel_id": rid, "before": before,
                                  "generation": generation, "description": description, "at": time.time()})

    def undo(self, jid, generation, revision):
        entries = [x for x in self.db.list("edit") if x["job_id"] == jid and x["generation"] == generation]
        if not entries:
            raise Conflict("There is no Studio edit to undo at this generation.")
        previous = entries[-1]
        with self.o._txn(jid) as job:
            self.current(job, generation, revision)
            errors, prep = self.o._check_plan(job, previous["before"], None)
            if errors:
                raise ValueError("\n".join(errors))
            self.o._accept_plan(job, prep, "studio-user-undo", "Undid the previous Studio edit")
            job["needs"], job["status"] = None, "waiting:worker"

    def set_music(self, jid, request):
        uploaded = self.db.get("upload", request.upload_id)
        if not uploaded:
            raise ValueError("Music upload not found.")
        asset = self.assets.get(uploaded["asset"])
        if not asset.info.get("has_audio"):
            raise ValueError("Choose a file with an audio stream.")
        with self.o._txn(jid) as job:
            self.current(job, request.generation, request.revision)
            plan = self.fs.read_json(job["plan"]["path"])
            plan["music"] = {"asset": asset.id, "gain_db": -18}
            job["inputs"]["music"] = [asset.id]
            job["inputs_rev"] += 1
            if not any(f.get("asset") == asset.id and f.get("role") == "music" for f in job["files"]):
                job["files"].append({"path": str(asset.path), "role": "music", "asset": asset.id,
                                     "sha256": asset.meta["sha256"], "added_rev": job["inputs_rev"], "role_source": "explicit"})
            job["request"]["assets"].append({"path": str(asset.path), "role": "music"})
            job["request_hash"] = self.fs.sha256_json(job["request"])
            errors, prep = self.o._check_plan(job, plan, job.get("repair"))
            if errors:
                raise ValueError("\n".join(errors))
            self.o._accept_plan(job, prep, "studio-music", "Updated project background music")
            job["needs"], job["status"] = None, "waiting:worker"

    def verify(self, jid, decision):
        job = self.job(jid)
        self.idle(job)
        n = job.get("needs") or {}
        if n.get("step") != "verify_style" or n.get("need_id") != decision.need_id or n.get("revision") != decision.revision:
            raise Conflict("This style review is stale. Refresh before continuing.")
        style = self.fs.read_json(n["style"])
        style["review"] = dict(style.get("review") or {}, verified=True)
        target = self.o._dir(jid) / "inbox" / f"{n['need_id']}.studio-style.json"
        self.fs.atomic_write_json(target, style)
        self.o.complete(jid, "verify_style", need_id=n["need_id"], revision=n["revision"],
                        result_file=str(target), note="User confirmed measured style in Studio")

    def decision(self, jid, action, decision):
        self.idle(self.job(jid))
        self.o.decide_storyboard(jid, action, decision.need_id, decision.revision, decision.sha256, decision.notes)

    def review(self, jid, decision):
        job = self.job(jid)
        self.idle(job)
        n = job.get("needs") or {}
        if n.get("step") != "review" or n.get("need_id") != decision.need_id or n.get("revision") != decision.revision:
            raise Conflict("This render review changed. Refresh before continuing.")
        result = {"schema_version": 1, "job_id": jid, "need_id": n["need_id"], "expected_revision": n["revision"],
                  "plan_generation": job["plan_generation"], "results": decision.results}
        target = self.o._dir(jid) / "inbox" / f"{n['need_id']}.studio-review.json"
        self.fs.atomic_write_json(target, result)
        self.o.complete(jid, "review", need_id=n["need_id"], revision=n["revision"], result_file=str(target),
                        note="User reviewed the rendered reels in Studio")

    def tick(self):
        """Only perform initially requested planning. Never approve style, board or render review."""
        for meta in self.db.list("project"):
            if not meta.get("auto_plan"):
                continue
            try:
                job = self.job(meta["id"])
                if job["terminal"]:
                    self.db.put("project", meta["id"], {**meta, "auto_plan": False})
                elif (job.get("needs") or {}).get("step") == "plan" and not job["plan_generation"]:
                    self.plan(meta["id"])
                    self.start(meta["id"])
            except Exception as e:
                self.db.put("project", meta["id"], {**meta, "auto_plan": False, "planning_error": str(e)[:2000]})
