import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { createComputerSharing } from "../electron/computer-sharing.mjs";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
const fakeCua = `
const {createInterface}=require('node:readline');
const {appendFileSync}=require('node:fs');
createInterface({input:process.stdin}).on('line', line=>{
 const m=JSON.parse(line);if(m.id===undefined)return;let result;
 if(m.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'synthetic-mac',version:'1'}};
 else if(m.method==='tools/list')result={tools:[{name:'screenshot',description:'Read synthetic Mac screen',inputSchema:{type:'object',properties:{},additionalProperties:false}}]};
 else if(m.method==='tools/call'){appendFileSync(process.env.FIXTURE_EFFECT,'called\\n');result={content:[{type:'image',mimeType:'image/png',data:${JSON.stringify(PNG)}}]};}
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
});`;

it("selects a paired Mac, approves its screenshot, and fails closed after disconnect", async () => {
  const requests: any[] = [];
  const upstream = createServer(async (req, res) => {
    if (req.url === "/v1/models") { res.end(JSON.stringify({ data: [{ id: "deepseek-flash" }] })); return; }
    let body = ""; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body); requests.push(request);
    const continued = request.messages.some((m: any) => m.role === "tool");
    const delta = continued ? { content: "I received the paired Mac screenshot." } : { tool_calls: [{ index: 0, id: "mac-screen", type: "function", function: { name: "computer_screenshot", arguments: "{}" } }] };
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: continued ? "stop" : "tool_calls" }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address() as { port: number };
  const fixture = await launchVerificationServer({}, undefined, undefined, undefined, undefined, undefined, [], undefined, `http://127.0.0.1:${address.port}`);
  let connector: ReturnType<typeof createComputerSharing> | undefined;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(fixture.info.url + path, { method, headers: { origin: fixture.info.url, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json() as any;
    expect(response.ok, JSON.stringify(result)).toBe(true); return result;
  };
  const control = (args: string[]) => runControlOmb([...args, "--url", fixture.info.url]) as Promise<any>;
  try {
    await api("PATCH", "/api/config", { features: { sharedComputers: true }, deepseek: { key: "synthetic-key", url: `http://127.0.0.1:${address.port}/v1`, model: "deepseek-flash" } });
    const opened = await api("POST", "/api/auth/pairing", { label: "Synthetic Mac", scopes: ["client"] });
    const paired = await api("POST", "/api/auth/pair", { code: opened.code });
    const env = { id: randomUUID(), origin: fixture.info.url, name: "Windows fixture" };
    const effect = join(fixture.info.dataDir, "synthetic-mac-effect");
    let leases = 0;
    connector = createComputerSharing({
      file: join(fixture.info.dataDir, "mac-grants", "computer-sharing.json"), environments: () => [env], enabled: async () => true,
      fetch: (url, init) => fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${paired.token}` } }),
      cuaConnection: async () => ({ mcpCommand: process.execPath, mcpArgs: ["-e", fakeCua], mcpEnv: { FIXTURE_EFFECT: effect } }),
      hostControl: async () => { leases++; return { renew: async () => {}, release: async () => {} }; },
    });
    await connector.save(env, { folders: [], terminal: false, computer: true }, await connector.identity(env));
    let target: any;
    await vi.waitFor(async () => { target = (await api("GET", "/api/shared-computers")).computers[0]; expect(target?.computer).toBe(true); }, { timeout: 15000 });
    const bot = (await api("POST", "/api/bots", { name: "Paired Mac tester", modelSelection: { instanceId: "deepseek", model: "deepseek-flash", effort: "none" } })).bot;
    await api("PATCH", `/api/bots/${bot.id}`, { computer: "local", sharedComputerId: target.id });
    const state = (await api("GET", "/api/bots")).bots.find((entry: any) => entry.id === bot.id);
    expect(state.sharedComputerId).toBe(target.id);
    expect((await api("GET", "/api/instances")).instances.find((entry: any) => entry.instanceId === "deepseek").models.options.some((entry: any) => entry.id === "deepseek-flash")).toBe(true);
    await control(["send", "--bot", bot.id, "--task", bot.threadId, "--text", "Inspect my paired Mac screen."]);
    const wait = () => control(["wait", "--bot", bot.id, "--task", bot.threadId, "--timeout", "25"]);
    const pending = await wait();
    expect(pending.status, JSON.stringify(pending)).toBe("needs-user");
    expect(existsSync(effect)).toBe(false);
    const current = (await api("GET", "/api/bots")).bots.find((entry: any) => entry.id === bot.id);
    const card = current.messages.find((message: any) => message.card?.requestId && !message.card.answered).card;
    await api("POST", `/api/bots/${bot.id}/respond`, { threadId: bot.threadId, requestId: card.requestId, behavior: "allow" });
    expect((await wait()).status).toBe("settled");
    expect(readFileSync(effect, "utf8")).toBe("called\n");
    expect(leases).toBeGreaterThan(0);
    expect(requests).toHaveLength(2);
    expect(requests[1].messages.at(-1).content).toContainEqual({ type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } });
    await control(["send", "--bot", bot.id, "--task", bot.threadId, "--text", "Inspect the paired Mac again, subject to approval."]);
    expect((await wait()).status).toBe("needs-user");
    const second = (await api("GET", "/api/bots")).bots.find((entry: any) => entry.id === bot.id);
    const secondCard = second.messages.find((message: any) => message.card?.requestId && !message.card.answered).card;
    await api("POST", `/api/bots/${bot.id}/respond`, { threadId: bot.threadId, requestId: secondCard.requestId, behavior: "deny" });
    expect((await wait()).status).toBe("failed");
    expect(readFileSync(effect, "utf8")).toBe("called\n");
    expect(requests).toHaveLength(4);
    connector.revoke(env);
    await vi.waitFor(async () => expect((await api("GET", "/api/shared-computers")).computers).toEqual([]), { timeout: 10000 });
    await control(["send", "--bot", bot.id, "--task", bot.threadId, "--text", "Check the same Mac again."]);
    const stopped = await wait();
    expect(stopped.status).toBe("failed");
    expect(requests).toHaveLength(4); // no provider request and no host fallback
    writeFileSync(`${fixture.info.logPath}.paired-mac.json`, JSON.stringify({ fixture: fixture.info, approvedScreenshot: true, stopped, actualDesktopUsed: false }, null, 2));
  } finally {
    connector?.close(); await fixture.close(); upstream.closeAllConnections(); await new Promise<void>(resolve => upstream.close(() => resolve()));
  }
}, 90000);
