import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class ScriptedResponse:
    """A urllib-like response that can fail after selected chunks."""

    def __init__(self, chunks=(), error=None, content_type="text/event-stream"):
        self._chunks = list(chunks)
        self._error = error
        self._read_index = 0
        self.headers = {"Content-Type": content_type}

    def __iter__(self):
        yield from self._chunks
        if self._error:
            raise self._error

    def read(self, _size=-1):
        if self._read_index < len(self._chunks):
            chunk = self._chunks[self._read_index]
            self._read_index += 1
            return chunk
        if self._error:
            error, self._error = self._error, None
            raise error
        return b""


class LocalJsonServer:
    """Small loopback HTTP server for release/upstream tests.

    Routes map URL paths to ``(status, json_body)``.  No request body or header
    is printed, which keeps accidental credentials out of test logs.
    """

    def __init__(self, routes):
        self.routes = dict(routes)
        self.requests = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def _serve(self):
                owner.requests.append((self.command, self.path))
                status, body = owner.routes.get(self.path, (404, {"error": "not found"}))
                payload = json.dumps(body).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            do_GET = _serve
            do_POST = _serve

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
