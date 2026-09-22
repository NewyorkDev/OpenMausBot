import { describe, expect, it } from "vitest";
import { supportsLocalComputer } from "./computer-capabilities";

describe("model-specific local computer support", () => {
  it("preserves unrestricted engines and rejects missing capability", () => {
    expect(supportsLocalComputer({ localComputerMcp: true }, "existing-model")).toBe(true);
    expect(supportsLocalComputer(undefined, "deepseek-flash")).toBe(false);
    expect(supportsLocalComputer({ localComputerModels: ["deepseek-flash"] }, "deepseek-flash")).toBe(false);
  });
  it("offers Flash but refuses Pro and unknown models", () => {
    const caps = { localComputerMcp: true, localComputerModels: ["deepseek-flash"], autoLocalComputer: false };
    expect(supportsLocalComputer(caps, "deepseek-flash")).toBe(true);
    expect(supportsLocalComputer(caps, "deepseek-v4-pro")).toBe(false);
    expect(supportsLocalComputer(caps, "unknown")).toBe(false);
  });
});
