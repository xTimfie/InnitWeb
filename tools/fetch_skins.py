import hashlib
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path

import requests
from PIL import Image


IMAGE_SIZE = (64, 64)
MAX_THREADS = 16
TIMEOUT_SECS = 15


def md5_bytes(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()


def fetch_skin_png(username: str) -> bytes | None:
    url = f"https://minotar.net/skin/{username}"
    try:
        resp = requests.get(url, timeout=TIMEOUT_SECS)
        if resp.status_code != 200:
            return None
        img = Image.open(BytesIO(resp.content)).convert("RGBA")
        img = img.resize(IMAGE_SIZE, Image.NEAREST)
        out = BytesIO()
        img.save(out, format="PNG")
        return out.getvalue()
    except Exception:
        return None


def process_node(node: dict, skins_dir: Path) -> int:
    username = node.get("username")
    uuid = node.get("uuid")
    if not username or not uuid:
        return 0

    png_bytes = fetch_skin_png(username)
    if not png_bytes:
        return 0

    out_path = skins_dir / f"{uuid}.png"
    if out_path.exists():
        try:
            existing = out_path.read_bytes()
            if md5_bytes(existing) == md5_bytes(png_bytes):
                return 0
        except Exception:
            pass

    out_path.write_bytes(png_bytes)
    return 1


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    graph_path = repo_root / "data" / "graph_optimized.json"
    skins_dir = repo_root / "data" / "skins"
    skins_dir.mkdir(parents=True, exist_ok=True)

    if not graph_path.exists():
        raise FileNotFoundError(f"Missing {graph_path}")

    data = json.loads(graph_path.read_text(encoding="utf-8"))
    nodes = data.get("nodes", [])
    edges = data.get("edges", [])

    connected_ids: set[str] = set()
    for e in edges:
        f = e.get("from_user_id")
        t = e.get("to_user_id")
        if f and t:
            connected_ids.add(f)
            connected_ids.add(t)

    nodes = [n for n in nodes if n.get("uuid") in connected_ids]

    saved = 0
    with ThreadPoolExecutor(max_workers=MAX_THREADS) as executor:
        futures = [executor.submit(process_node, node, skins_dir) for node in nodes]
        for f in as_completed(futures):
            try:
                saved += int(f.result())
            except Exception:
                pass

    print(f"Finished fetching skins. New/updated skins: {saved}")


if __name__ == "__main__":
    main()
