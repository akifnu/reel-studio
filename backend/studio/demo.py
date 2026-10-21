"""Create a clearly labelled, local demo without downloading or invoking speech models."""
import argparse
from pathlib import Path
import subprocess

from .config import Settings
from .storage import Store
from .bridge import Pipeline


def seed(p, source=None, name="A little practice. A better story.", preview=True):
    generated = p.settings.root / "demo-source.mp4"
    if source is None:
        if not generated.exists():
            ff = __import__("reelkit.paths", fromlist=["FFMPEG"])
            subprocess.run([ff.FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=360x640:r=30:d=9",
                            "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000:duration=9",
                            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
                            "-shortest", str(generated)], check=True)
        source = generated
    asset = p.assets.ingest(source, "source")
    duration = asset.info["duration"]
    texts = ["Good stories start with a little curiosity.", "Small details make a difference.", "Make something worth sharing."]
    words, step = [], duration / 28
    t = .15
    for sentence in texts:
        for word in sentence.split():
            words.append({"w": word, "s": round(t, 3), "e": round(t+step*.8, 3)})
            t += step
        t += step * 1.5
    tr = {"lang": "en", "timing": "word", "provider": "cpu", "duration": duration,
          "fingerprint": p.asr.fingerprint("en"), "words": words, "sentences": p.asr.sentences(words)}
    # Demo captions are invented examples and are labelled in the UI. Never overwrite
    # a real asset's transcript: make a separate demo-owned data directory for this command.
    if asset.cache("transcript.en.json").exists():
        existing = p.fs.read_json(asset.cache("transcript.en.json"))
        if existing.get("demo") is not True:
            raise ValueError("This asset has a real transcript. Use an isolated REELKIT_DATA directory for the demo.")
    tr["demo"] = True
    p.fs.atomic_write_json(asset.cache("transcript.en.json"), tr)
    job = p.o.create(roles={"source": [asset.path], "sample": [asset.path]}, count=2, lang="en",
                     execution={"encoder": "cpu"})
    jid = job["id"]
    ctx = p.o._context(job, "intake")
    ingested = p.o._w_intake(ctx)
    with p.o._txn(jid) as job:
        p.o._c_intake(job, ctx, ingested)
        p.o._publish_style(job, p.preset(asset, "clean"), asset.id, "studio-demo", "demo style preset")
        for stage in ("analyze", "transcribe"):
            job["steps"][stage] = {"done": True, "key": p.o._key(job, stage)}
        plan = {"name": jid, "style": job["style_version"]["path"], "sources": {"A": asset.id},
                "output": {"width": 720, "height": 1280, "fps": 30, "lang": "en"},
                "reels": [{"id": "r01", "title": "A little curiosity", "segments": [{"src": "A", "sentences": [0, 0]}]},
                          {"id": "r02", "title": "The details matter", "segments": [{"src": "A", "sentences": [1, 2]}]}]}
        errors, prep = p.o._check_plan(job, plan, None)
        if errors:
            raise ValueError("\n".join(errors))
        p.o._accept_plan(job, prep, "studio-demo", "demo storyboard")
    p.db.put("project", jid, {"id": jid, "name": name, "demo": True, "auto_plan": False})
    if preview:
        result = p.o.advance(jid)
        if result["status"] != "needs:approve_storyboard":
            raise RuntimeError(str(result.get("error")))
    return jid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path)
    args = parser.parse_args()
    settings = Settings.load()
    p = Pipeline(settings, Store(settings.root))
    jid = seed(p, args.source)
    print(f"Created demo {jid}. Open http://127.0.0.1:8000/?project={jid}")


if __name__ == "__main__":
    main()
