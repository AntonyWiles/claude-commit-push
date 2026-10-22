"""HTTP peer sync: an alternative to SSH + rsync, with no admin rights needed.

Each machine serves only its own ledger folder, ~/.claude/usage-meter/hosts/<host>/,
read-only, to callers that present the shared token and come from an allowed subnet.
Each machine pulls every peer's folder into hosts/<peer>/ locally. Nothing is ever
pushed, so a host's folder is still written only by that host's own collector.

local/collector.json:
  "listen": 8765,                          port to serve on (omit to not serve)
  "token": "<long random string>",         same on every machine
  "allow": ["192.168.1.0/24"],             client subnets (default: the local /24s only)
  "peers": [{"name": "test-bed", "url": "http://192.168.1.181:8765"}]
"""

from __future__ import annotations

import hmac
import ipaddress
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from view import replace_file

NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
MAX_FILE = 32 * 1024 * 1024


def _safe_rel(rel: str) -> bool:
    parts = rel.split("/")
    return bool(parts) and all(p and p not in (".", "..") and NAME_RE.match(p) for p in parts)


def manifest(folder: str) -> dict:
    out = {}
    for dirpath, _dirs, files in os.walk(folder):
        for f in files:
            if f.endswith(".tmp"):
                continue
            full = os.path.join(dirpath, f)
            rel = os.path.relpath(full, folder).replace(os.sep, "/")
            if not _safe_rel(rel):
                continue
            try:
                st = os.stat(full)
            except OSError:
                continue
            out[rel] = [st.st_size, int(st.st_mtime * 1000)]
    return out


class Server:
    def __init__(self, root: str, host: str, port: int, token: str, allow: list) -> None:
        self.folder = os.path.join(root, "hosts", host)
        self.token = token.encode()
        self.nets = [ipaddress.ip_network(a, strict=False) for a in allow]
        srv = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def _deny(self, code: int) -> None:
                self.send_response(code)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def do_GET(self):
                try:
                    ip = ipaddress.ip_address(self.client_address[0])
                except ValueError:
                    return self._deny(403)
                if not any(ip in n for n in srv.nets):
                    return self._deny(403)
                got = (self.headers.get("Authorization") or "").removeprefix("Bearer ").encode()
                if not hmac.compare_digest(got, srv.token):
                    return self._deny(401)
                url = urllib.parse.urlsplit(self.path)
                if url.path == "/manifest":
                    body = json.dumps(manifest(srv.folder)).encode()
                elif url.path == "/file":
                    rel = urllib.parse.parse_qs(url.query).get("p", [""])[0]
                    if not _safe_rel(rel):
                        return self._deny(400)
                    full = os.path.join(srv.folder, *rel.split("/"))
                    try:
                        with open(full, "rb") as fh:
                            body = fh.read(MAX_FILE + 1)
                    except OSError:
                        return self._deny(404)
                    if len(body) > MAX_FILE:
                        return self._deny(413)
                else:
                    return self._deny(404)
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
        self.httpd.daemon_threads = True

    def start(self) -> None:
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()


class HttpSyncer:
    """Same interface as umeter.Syncer: sync_all() and .results."""

    def __init__(self, cfg: dict, root: str, now_ms) -> None:
        self.host = cfg["host"]
        self.root = root
        self.token = cfg.get("token", "")
        self.peers = [p for p in cfg.get("peers", []) if p.get("url")]
        self.results: dict = {}
        self.now_ms = now_ms

    def _get(self, base: str, path: str) -> bytes:
        req = urllib.request.Request(base.rstrip("/") + path, headers={"Authorization": "Bearer " + self.token})
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read(MAX_FILE + 1)
        if len(data) > MAX_FILE:
            raise RuntimeError("file too large")
        return data

    def sync_peer(self, peer: dict) -> None:
        name = peer["name"]
        if not NAME_RE.match(name) or name == self.host:
            raise RuntimeError(f"bad peer name {name!r}")
        dest = os.path.join(self.root, "hosts", name)
        remote = json.loads(self._get(peer["url"], "/manifest"))
        local = manifest(dest) if os.path.isdir(dest) else {}
        for rel, (size, mtime) in remote.items():
            if not _safe_rel(rel):
                continue
            if local.get(rel) == [size, mtime]:
                continue
            data = self._get(peer["url"], "/file?p=" + urllib.parse.quote(rel))
            full = os.path.join(dest, *rel.split("/"))
            os.makedirs(os.path.dirname(full), exist_ok=True)
            tmp = full + ".tmp"
            with open(tmp, "wb") as fh:
                fh.write(data)
            os.utime(tmp, ns=(mtime * 1_000_000, mtime * 1_000_000))
            replace_file(tmp, full)
        for rel in set(local) - set(remote):  # mirror deletes (pruned days)
            try:
                os.remove(os.path.join(dest, *rel.split("/")))
            except OSError:
                pass

    def sync_all(self) -> None:
        for peer in self.peers:
            name = peer.get("name", peer["url"])
            prev = self.results.get(name, {})
            try:
                self.sync_peer(peer)
                self.results[name] = {"ok": True, "at": self.now_ms(), "lastOk": self.now_ms()}
            except Exception as err:  # offline, asleep, refused: retried next round
                self.results[name] = {"ok": False, "at": self.now_ms(), "lastOk": prev.get("lastOk", 0), "error": str(err)[:200]}
