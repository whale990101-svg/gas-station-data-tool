"""Generate the standalone browser app from the shared application files."""
import base64
import gzip
from pathlib import Path
import re

from serve import MAP, ROOT, SOURCE_FILES


def script_contents(filename):
    source = (ROOT / filename).read_text(encoding="utf-8")
    source = re.sub(r'^import [^\n]+;\n', "", source, flags=re.MULTILINE)
    return re.sub(r"^export ", "", source, flags=re.MULTILINE)


def embed_asset(identifier, served_file):
    raw = (ROOT / served_file.lstrip("/")).read_bytes()
    encoded = base64.b64encode(gzip.compress(raw, compresslevel=6, mtime=0)).decode("ascii")
    return f'<script type="application/octet-stream" id="asset-{identifier}">{encoded}</script>'


def build():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    stylesheet = (ROOT / "style.css").read_text(encoding="utf-8")
    script = "\n".join(map(script_contents, ("platform.js", "data.js", "map.js", "app.js")))
    html = html.replace('<link rel="stylesheet" href="./style.css">', f"<style>\n{stylesheet}</style>")
    html = html.replace('<script src="./launch.js" defer></script>', f'<script type="module">\n{script}\n</script>')
    hero = base64.b64encode((ROOT / "fuel-pump.png").read_bytes()).decode("ascii")
    html = html.replace('src="./fuel-pump.png"', f'src="data:image/png;base64,{hero}"')
    for route in ("/extract", "/lookup", "/"):
        html = html.replace(f'href="{route}"', f'href="#{route.lstrip("/")}"')
    assets = [
        embed_asset("location", SOURCE_FILES["/source/location.csv"]),
        embed_asset("price", SOURCE_FILES["/source/price.csv"]),
        embed_asset("map", MAP),
    ]
    html = html.replace("</body>", "\n".join(assets) + "\n</body>")
    output = Path(ROOT / "offline.html")
    output.write_text(html, encoding="utf-8")
    return output


if __name__ == "__main__":
    print(build())
