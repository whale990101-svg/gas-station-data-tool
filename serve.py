"""Serve the viewer and its map over the local loopback interface."""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
MAP = "/전국주유소표준데이터/HangJeongDong_ver20261001.geojson"
PAGES = {"/", "/extract", "/lookup"}
SOURCE_FILES = {
    "/source/location.csv": "/전국주유소표준데이터/전국주유소표준데이터.csv",
    "/source/price.csv": "/전국주유소표준데이터/과거_판매가격(주유소)20261115-20261121.csv",
}
ASSETS = {"/index.html", "/style.css", "/app.js", "/data.js", "/fuel-pump.png",
          "/map.js", "/worker.js", "/platform.js", "/launch.js", MAP}


class LocalHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        if unquote(urlsplit(self.path).path) != MAP:
            self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; connect-src 'self'; object-src 'none'; "
                         "base-uri 'none'; frame-ancestors 'none'")
        super().end_headers()

    def send_head(self):
        path = unquote(urlsplit(self.path).path)
        if path in PAGES:
            self.path = "/index.html"
        elif path in SOURCE_FILES:
            self.path = SOURCE_FILES[path]
        elif path not in ASSETS:
            self.send_error(404)
            return None
        return super().send_head()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    with ThreadingHTTPServer(("127.0.0.1", args.port), LocalHandler) as server:
        print(f"http://127.0.0.1:{server.server_port}/", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
