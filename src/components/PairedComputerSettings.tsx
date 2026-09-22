import { useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";

export function PairedComputerSettings() {
  const { state, dispatch } = useStore();
  const enabled = state.config?.features?.sharedComputers === true;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  return <section className="my-3 rounded-xl border border-hairline/40 p-3 text-[12px] text-ink-secondary">
    <label className="flex items-center gap-2 font-medium text-ink">
      <input type="checkbox" checked={enabled} disabled={busy} onChange={async event => {
        setBusy(true); setError("");
        try {
          const config: ConfigStatus = await api("/api/config", { method: "PATCH", body: JSON.stringify({ features: { sharedComputers: event.target.checked } }) });
          dispatch({ type: "configStatus", config });
        } catch (e) { setError(e instanceof Error ? e.message : "Could not save computer sharing"); }
        finally { setBusy(false); }
      }} />Enable paired computers
    </label>
    <p className="mt-2">Your bots stay on this Windows workspace. On the Mac, enable this setting, connect this workspace in Connected workspaces, then grant Computer control. The Mac appears in each bot’s Computer panel.</p>
    {enabled && <button type="button" disabled={busy} className="mt-2 rounded border border-hairline px-2 py-1 text-ink" onClick={async () => {
      setBusy(true); setError("");
      try { const pairing = await api("/api/auth/pairing", { method: "POST", body: JSON.stringify({ label: "Paired Mac", scopes: ["client"] }) }); setCode(pairing.code); }
      catch (e) { setError(e instanceof Error ? e.message : "Could not create pairing code"); }
      finally { setBusy(false); }
    }}>Create Mac pairing code</button>}
    {code && <p className="mt-2">On the Mac, connect the Windows HTTPS address below and enter this one-use code: <code className="select-all font-semibold text-ink">{code}</code>. Keep this code private.</p>}
    <p className="mt-2">Restart this app after changing the paired-computers setting.</p>
    <details className="mt-2"><summary className="cursor-pointer">Private connection setup (Tailscale)</summary>
      <p className="mt-2">Install Tailscale on both computers and sign into the same private network. On Windows, run:</p>
      <code className="my-2 block select-all break-all rounded bg-inset p-2">tailscale serve --bg --https=8443 http://127.0.0.1:8799</code>
      <p>Use the HTTPS .ts.net address it prints in the Mac’s Connected workspaces. Use workspace pairing, not Desktop companion mode. Cloudflare and a public tunnel are unnecessary.</p>
      <p className="mt-2">Keep both apps open. The Mac asks you to approve the exact sharing permissions. Model providers can receive screenshots when computer tools are used.</p>
    </details>
    {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
  </section>;
}
