"""One SQLite database, explicit ownership and short atomic write transactions."""
from __future__ import annotations

from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import threading

from .models import Model


class Store:
    def __init__(self, path: str | Path):
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), isolation_level=None, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        self.db.executescript("""
            PRAGMA journal_mode=WAL;
            PRAGMA busy_timeout=5000;
            CREATE TABLE IF NOT EXISTS records (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,
                id TEXT NOT NULL, user_id TEXT NOT NULL, branch_id TEXT NOT NULL,
                actor_id TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(kind,id));
            CREATE INDEX IF NOT EXISTS records_scope
                ON records(user_id,branch_id,kind,actor_id,seq);
            CREATE TABLE IF NOT EXISTS operations (
                user_id TEXT, scope TEXT, request_id TEXT, fingerprint TEXT,
                body TEXT, PRIMARY KEY(user_id,scope,request_id));
        """)

    @contextmanager
    def transaction(self):
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                yield
                self.db.execute("COMMIT")
            except BaseException:
                self.db.execute("ROLLBACK")
                raise

    def put(self, kind: str, value: Model | dict, *, id: str | None = None,
            user_id: str | None = None, branch_id: str | None = None,
            actor_id: str | None = None) -> dict:
        data = value.model_dump() if isinstance(value, Model) else value
        ident = id or data.get("id") or data.get("branch_id")
        owner = user_id or data["user_id"]
        with self.lock:
            old = self.db.execute("SELECT user_id FROM records WHERE kind=? AND id=?",
                                  (kind, ident)).fetchone()
            if old and old["user_id"] != owner:
                raise ValueError("record ownership mismatch")
            self.db.execute("""INSERT INTO records(kind,id,user_id,branch_id,actor_id,body)
                VALUES(?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body""",
                (kind, ident, owner, branch_id or data.get("branch_id", ""),
                 actor_id or data.get("actor_id", ""), json.dumps(data, ensure_ascii=False)))
        return data

    def get(self, kind: str, id: str, user_id: str) -> dict:
        with self.lock:
            row = self.db.execute("SELECT body FROM records WHERE kind=? AND id=? AND user_id=?",
                                  (kind, id, user_id)).fetchone()
        if not row:
            raise KeyError("record not found")
        return json.loads(row["body"])

    def list(self, kind: str, user_id: str, branch_id: str | None = None,
             actor_id: str | None = None) -> list[dict]:
        clauses, args = ["kind=?", "user_id=?"], [kind, user_id]
        for column, value in (("branch_id", branch_id), ("actor_id", actor_id)):
            if value is not None:
                clauses.append(f"{column}=?")
                args.append(value)
        with self.lock:
            rows = self.db.execute("SELECT body FROM records WHERE " + " AND ".join(clauses)
                                   + " ORDER BY seq", args).fetchall()
        return [json.loads(row["body"]) for row in rows]

    def operation(self, user: str, scope: str, request: str, fingerprint: str) -> dict | None:
        with self.lock:
            row = self.db.execute("SELECT fingerprint,body FROM operations WHERE user_id=? AND scope=? AND request_id=?",
                                  (user, scope, request)).fetchone()
        if row:
            if row["fingerprint"] != fingerprint:
                raise ValueError("request_id reused with different input")
            return json.loads(row["body"])
        return None

    def claim(self, user: str, scope: str, request: str, fingerprint: str):
        """Freeze input before any model call; a failed call can retry only that input."""
        import hashlib
        ident = hashlib.sha256((user + "\0" + scope + "\0" + request).encode()).hexdigest()
        with self.lock:
            try:
                prior = self.get("request_claim", ident, user)
                if prior["fingerprint"] != fingerprint:
                    raise ValueError("request_id reused with different input")
            except KeyError:
                self.put("request_claim", {"id": ident, "user_id": user, "scope": scope,
                    "request_id": request, "fingerprint": fingerprint})

    def finish(self, user: str, scope: str, request: str, fingerprint: str, result: dict):
        with self.lock:
            self.db.execute("INSERT INTO operations VALUES(?,?,?,?,?)",
                            (user, scope, request, fingerprint, json.dumps(result, ensure_ascii=False)))

    def close(self):
        self.db.close()
