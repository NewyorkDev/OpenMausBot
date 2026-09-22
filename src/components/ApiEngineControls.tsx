import { useState } from "react";
import { api, useStore, type InstanceInfo } from "@/state/store";

/** API engines use the existing instance tools flag and workspace default. */
export function ApiEngineControls({ instance }: { instance: InstanceInfo }) {
  const { refreshInstances } = useStore();
  const [model, setModel] = useState(instance.models.default);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (instance.readOnly) return null;
  const tools = instance.capabilities?.agentsMcp !== false;
  const save = async (url: string, body: unknown, success: string) => {
    setBusy(true);
    setMessage("");
    try {
      await api(url, { method: "PATCH", body: JSON.stringify(body) });
      setMessage(success);
      await refreshInstances();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save engine settings.");
    } finally { setBusy(false); }
  };
  return <div className="mt-3 space-y-2 text-[12px] text-ink-secondary">
    {instance.instanceId === "deepseek" && <p>V4.1 Flash and V4 Pro support chat and tool calls. Reasoning effort controls thinking; None turns thinking off. Flash also supports This computer with tool calls enabled. Pro is for chat and other tools. Ordinary chat does not require a computer destination.</p>}
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={tools} disabled={busy || instance.snapshot.state !== "available"}
        onChange={(event) => void save(`/api/instances/${encodeURIComponent(instance.instanceId)}`, { tools: event.target.checked }, "Tool setting saved.")} />
      Enable tool calls for this engine
    </label>
    <p>Applies to all chats using {instance.displayName}. Turn off for text-only conversations.</p>
    <details><summary className="cursor-pointer">Default for new bots</summary>
    <div className="mt-2 flex flex-wrap gap-2">
      <select aria-label={`Default model for new bots using ${instance.displayName}`} value={model} disabled={busy}
        onChange={(event) => setModel(event.target.value)} className="min-w-0 max-w-full rounded border border-hairline bg-panel p-1 text-ink">
        {instance.models.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      <button type="button" disabled={busy || !model || instance.snapshot.state !== "available"}
        className="rounded border border-hairline px-2 py-1 text-ink disabled:opacity-50"
        onClick={() => void save("/api/config", { defaultModelSelection: { instanceId: instance.instanceId, model } }, `New bots will use ${instance.displayName} / ${model}.`)}>Use for new bots</button>
    </div></details>
    {message && <p role="status">{message}</p>}
  </div>;
}
