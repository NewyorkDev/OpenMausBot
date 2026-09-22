# Project architecture snapshot

DeepSeek's September 22, 2026 Graphify run: 24,073 nodes and 64,072 edges.

- `graph.json`: machine-readable architecture graph.
- `graph.html`: generated visual explorer.
- `GRAPH_REPORT.md`: communities, hubs and extraction summary.
- `manifest.json`: source fingerprints for incremental work.
- `cost.json`: recorded extraction usage.

This is a discovery snapshot, not proof of current behavior. Check source and
verification recipes before relying on inferred relationships. The run records
base commit `66da7a52` and includes working-tree changes; later additions may not
be represented. The original snapshot is preserved without rerunning extraction.
Caches and temporary chunk files stay local and are not needed to read the graph.
