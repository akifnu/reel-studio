"""Small persistent UI metadata store. Pipeline job state remains owned by reelkit."""
import json
from contextlib import contextmanager
import sqlite3
import time
import uuid
from pathlib import Path


class Store:
    def __init__(self, root: Path):
        root.mkdir(parents=True, exist_ok=True)
        self.path = root / "studio.sqlite3"
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE IF NOT EXISTS records (kind TEXT, id TEXT, value TEXT, PRIMARY KEY(kind,id))")
            db.execute("CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, job TEXT, path TEXT, name TEXT, UNIQUE(job,path))")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=20)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def put(self, kind, key, value):
        with self.connect() as db:
            db.execute("INSERT INTO records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value",
                       (kind, key, json.dumps(value)))
        return value

    def get(self, kind, key):
        with self.connect() as db:
            row = db.execute("SELECT value FROM records WHERE kind=? AND id=?", (kind, key)).fetchone()
        return json.loads(row["value"]) if row else None

    def list(self, kind):
        with self.connect() as db:
            rows = db.execute("SELECT value FROM records WHERE kind=? ORDER BY rowid", (kind,)).fetchall()
        return [json.loads(r["value"]) for r in rows]

    def media(self, job, path, name=None):
        p = str(Path(path).resolve())
        with self.connect() as db:
            db.execute("INSERT OR IGNORE INTO media VALUES (?,?,?,?)", (uuid.uuid4().hex, job, p, name or Path(p).name))
            row = db.execute("SELECT id FROM media WHERE job=? AND path=?", (job, p)).fetchone()
        return f"/api/media/{row['id']}"

    def artifact(self, key):
        with self.connect() as db:
            row = db.execute("SELECT * FROM media WHERE id=?", (key,)).fetchone()
        return dict(row) if row else None

    def task(self, action, job=None):
        key = uuid.uuid4().hex
        self.put("task", key, {"id": key, "action": action, "job_id": job, "status": "queued", "created": time.time()})
        return key
