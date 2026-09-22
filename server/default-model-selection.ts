import type { EffortLevel, ModelCatalog, ModelSelection, ProviderSnapshot } from "./contracts.ts";

interface SelectableInstance {
  instanceId: string;
  driverKind: string;
  snapshot: ProviderSnapshot;
  models: ModelCatalog;
  capabilities?: { effortLevels?: readonly EffortLevel[]; modelVariants?: boolean };
}

/** The shipped DeepSeek engine, by the id server/config.ts registers it under.
 * This build exists to drive DeepSeek, so a runnable DeepSeek is the default
 * rather than a fallback: without this, a fleet where the person configured a
 * DeepSeek key still started every new bot on whatever other CLI happened to
 * be installed, because the Claude preference below is unconditional. */
const DEEPSEEK_ENGINE_ID = "deepseek";

/** A saved choice is intentional: an unavailable provider or removed model
 * sends new bots to setup instead of silently changing their provider. */
export function selectDefaultModelSelection(
  instances: readonly SelectableInstance[],
  preferred?: ModelSelection,
): ModelSelection {
  if (preferred) {
    const instance = instances.find((candidate) => candidate.instanceId === preferred.instanceId);
    if (
      instance?.snapshot.state !== "available" ||
      instance.snapshot.authenticated === false ||
      (preferred.variant !== undefined && !instance.capabilities?.modelVariants) ||
      !(instance.models.default === preferred.model || instance.models.options.some((model) => model.id === preferred.model))
    ) {
      return { instanceId: "", model: "" };
    }
    const selection = { ...preferred };
    // A saved effort can outlive driver support. Keep the intentional model,
    // but let the provider use its own effort default instead of failing turn 1.
    if (selection.effort && !instance.capabilities?.effortLevels?.includes(selection.effort)) delete selection.effort;
    return selection;
  }
  const available = instances.filter((instance) => instance.snapshot.state === "available");
  // DeepSeek first, then the Claude preference this rule has always had, then
  // fleet order. An unavailable DeepSeek therefore degrades to exactly the
  // previous behaviour rather than to no engine at all.
  const pick =
    available.find((instance) => instance.instanceId === DEEPSEEK_ENGINE_ID) ??
    available.find((instance) => instance.driverKind === "claudeAgent") ??
    available[0];
  return { instanceId: pick?.instanceId ?? "", model: pick?.models.default ?? "" };
}
