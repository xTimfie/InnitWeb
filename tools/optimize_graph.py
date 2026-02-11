import json
from pathlib import Path


def optimize_graph(graph: dict) -> dict:
    optimized_nodes = [
        {
            "uuid": node.get("uuid"),
            "username": node.get("username"),
        }
        for node in graph.get("nodes", [])
    ]

    optimized_edges = [
        {
            "from_user_id": edge.get("from_user_id"),
            "to_user_id": edge.get("to_user_id"),
            "total_mentions": edge.get("total_mentions", 1),
        }
        for edge in graph.get("edges", [])
    ]

    return {"nodes": optimized_nodes, "edges": optimized_edges}


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    input_path = repo_root / "data" / "graph.json"
    output_path = repo_root / "data" / "graph_optimized.json"

    if not input_path.exists():
        raise FileNotFoundError(f"Missing input file: {input_path}")

    with input_path.open("r", encoding="utf-8") as f:
        graph = json.load(f)

    optimized = optimize_graph(graph)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(optimized, f, separators=(",", ":"), ensure_ascii=False)

    print(f"Wrote {output_path} with {len(optimized['nodes'])} nodes and {len(optimized['edges'])} edges")


if __name__ == "__main__":
    main()
