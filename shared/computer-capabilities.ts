/** Model restrictions and automatic mounting share one policy across UI/server. */
export interface ComputerCapabilities {
  localComputerMcp?: boolean;
  localComputerModels?: readonly string[];
  autoLocalComputer?: boolean;
}
export function supportsLocalComputer(caps: ComputerCapabilities | undefined, model: string): boolean {
  return caps?.localComputerMcp === true && (!caps.localComputerModels || caps.localComputerModels.includes(model));
}
