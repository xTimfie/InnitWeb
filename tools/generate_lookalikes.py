import json
import os
from pathlib import Path

from PIL import Image
import numpy as np


TOP_N = 5
PIXEL_TOLERANCE = 10
BATCH_SIZE = 50


def load_skin(path: Path) -> np.ndarray | None:
    try:
        img = Image.open(path).convert("RGBA").resize((64, 64), Image.NEAREST)
        return np.array(img, dtype=np.uint8)
    except Exception:
        return None


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]

    graph_file = repo_root / "data" / "graph_optimized.json"
    skins_dir = repo_root / "data" / "skins"
    lookalikes_file = repo_root / "data" / "lookalikes.json"

    if not graph_file.exists():
        raise FileNotFoundError(f"Missing {graph_file}")

    graph_data = json.loads(graph_file.read_text(encoding="utf-8"))
    nodes = graph_data.get("nodes", [])
    edges = graph_data.get("edges", [])

    connected_ids: set[str] = set()
    for e in edges:
        f = e.get("from_user_id")
        t = e.get("to_user_id")
        if f and t:
            connected_ids.add(f)
            connected_ids.add(t)

    nodes = [n for n in nodes if n.get("uuid") in connected_ids]
    uuid_to_username = {n["uuid"]: n.get("username", n["uuid"]) for n in nodes if n.get("uuid")}
    uuids = [n["uuid"] for n in nodes if n.get("uuid")]

    max_nodes = os.getenv("MAX_NODES")
    if max_nodes:
        try:
            limit = int(max_nodes)
            uuids = uuids[:limit]
        except ValueError:
            pass

    loaded_skins: dict[str, np.ndarray] = {}
    for uuid in uuids:
        path = skins_dir / f"{uuid}.png"
        if not path.exists():
            continue
        skin = load_skin(path)
        if skin is not None:
            loaded_skins[uuid] = skin

    uuids = [u for u in uuids if u in loaded_skins]
    if not uuids:
        lookalikes_file.write_text("{}", encoding="utf-8")
        print("No skins available; wrote empty lookalikes.json")
        return

    skins_array = np.stack([loaded_skins[u] for u in uuids])
    alpha_masks = np.stack([skin[..., 3] > 0 for skin in skins_array])

    lookalikes_result: dict[str, list[dict]] = {}

    for i, uuid in enumerate(uuids):
        target_skin = skins_array[i]
        target_mask = alpha_masks[i]
        denom = max(1, int(target_mask.sum()))

        sims: list[tuple[float, str]] = []

        for j in range(0, len(uuids), BATCH_SIZE):
            batch_indices = [b for b in range(j, min(j + BATCH_SIZE, len(uuids))) if b != i]
            if not batch_indices:
                continue

            batch_skins = skins_array[batch_indices]

            diff = np.abs(batch_skins[..., :3].astype(int) - target_skin[..., :3].astype(int))
            similar_pixels = np.all(diff <= PIXEL_TOLERANCE, axis=3) & (target_mask[None, :, :])

            scores = similar_pixels.reshape(len(batch_indices), -1).sum(axis=1) / denom * 100
            for idx, score in zip(batch_indices, scores):
                sims.append((float(score), uuids[idx]))

        sims.sort(reverse=True, key=lambda x: x[0])
        top = [
            {
                "uuid": u,
                "username": uuid_to_username.get(u, u),
                "similarity": round(s, 2),
            }
            for s, u in sims[:TOP_N]
        ]
        lookalikes_result[uuid] = top

    lookalikes_file.write_text(json.dumps(lookalikes_result, indent=2), encoding="utf-8")
    print(f"Lookalikes saved to {lookalikes_file}")


if __name__ == "__main__":
    main()
