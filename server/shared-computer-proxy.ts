// One turn's MCP connection to an explicitly selected paired computer.
// The server binds the opaque bearer to the selected computer and generation.
import { createInterface } from "node:readline";
const endpoint = process.env.OMB_SHARED_COMPUTER_URL;
const token = process.env.OMB_SHARED_COMPUTER_TOKEN;
const abort = new AbortController();
let url: URL;
try {
  url = new URL(endpoint ?? "");
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || !token) throw new Error();
} catch { process.stderr.write("Invalid paired computer connection\n"); process.exit(2); }
const send = (id: unknown, result: unknown) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
const request = async (body: unknown) => {
  const response = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(50_000)]),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of response.body ?? []) {
    bytes += chunk.length;
    if (bytes > 4_000_000) throw new Error("Paired computer response exceeded limit");
    chunks.push(Buffer.from(chunk));
  }
  const reply = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!response.ok) throw new Error(reply.error ?? "Paired computer disconnected; inspect its state before retrying");
  return reply.result;
};
const lines = createInterface({ input: process.stdin });
let busy = false;
lines.on("line", async line => {
  let message: any;
  try {
    if (Buffer.byteLength(line) > 1_000_000) throw new Error("Request exceeds limit");
    message = JSON.parse(line);
    if (message.method === "notifications/cancelled") { abort.abort(); return; }
    if (message.id === undefined) return;
    if (message.method === "initialize") return send(message.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "paired-computer", version: "1" } });
    if (message.method === "ping") return send(message.id, {});
    if (!["tools/list", "tools/call"].includes(message.method)) throw new Error("Unsupported computer method");
    if (busy) throw new Error("A computer request is already running");
    busy = true;
    try {
      const result = await request(message.method === "tools/list" ? { action: "computer_tools" } : {
        action: "computer_call", tool_name: message.params?.name, arguments: message.params?.arguments ?? {},
      });
      if (message.method === "tools/list") {
        if (result?.isError) throw new Error("Paired computer tool discovery failed; check sharing and permissions on the Mac");
        const text = result?.content?.find((entry: any) => entry.type === "text")?.text;
        const catalog = JSON.parse(text ?? "null");
        if (!Array.isArray(catalog?.tools) || catalog.nextCursor !== undefined) throw new Error("Paired computer returned an invalid or incomplete tool catalog");
        send(message.id, catalog);
      } else send(message.id, result);
    } finally { busy = false; }
  } catch (error) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message?.id ?? null, error: { code: -32000, message: error instanceof Error ? error.message : "Paired computer request failed" } }) + "\n");
  }
});
lines.on("close", () => abort.abort());
