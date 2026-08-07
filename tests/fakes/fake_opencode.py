import json
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class FakeOpenCodeServer:
    """Minimal OpenCode 1.18-style HTTP double; loopback only."""

    def __init__(self):
        self.sessions = {}
        self.requests = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def _json(self, status, body):
                payload = json.dumps(body).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def _body(self):
                size = int(self.headers.get("Content-Length") or 0)
                return json.loads(self.rfile.read(size) or b"{}")

            def do_GET(self):
                owner.requests.append(("GET", self.path))
                if self.path == "/global/health":
                    return self._json(200, {"healthy": True})
                if self.path.startswith("/api/session/") and self.path.endswith("/message"):
                    sid = self.path.split("/")[3]
                    return self._json(200, owner.sessions.get(sid, {}).get("messages", []))
                if self.path.startswith("/api/session/"):
                    sid = self.path.split("/")[3]
                    if sid in owner.sessions:
                        return self._json(200, {"id": sid})
                return self._json(404, {"error": "not found"})

            def do_POST(self):
                owner.requests.append(("POST", self.path))
                body = self._body()
                if self.path.startswith("/api/session?") or self.path == "/api/session":
                    sid = "ses_" + uuid.uuid4().hex[:8]
                    owner.sessions[sid] = {"messages": []}
                    return self._json(200, {"id": sid})
                if self.path.endswith("/prompt"):
                    sid = self.path.split("/")[3]
                    owner.sessions.setdefault(sid, {"messages": []})["messages"].insert(
                        0, {"type": "assistant", "finish": "stop", "body": body}
                    )
                    return self._json(200, {"ok": True})
                if self.path.endswith("/interrupt"):
                    return self._json(200, {"ok": True})
                return self._json(404, {"error": "not found"})

            def log_message(self, *_args):
                return

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    @property
    def base_url(self):
        host, port = self.httpd.server_address
        return "http://%s:%d" % (host, port)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_exc):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
