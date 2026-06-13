/**
 * Deterministic viewer model id for a project file in the federated viewer.
 * Used by both the route (when building each `ViewerBundle.modelId`) and the
 * layer panel (when dispatching `model:setVisible`) so the two never drift.
 */
export function federatedModelId(fileId: string): string {
  return `file-${fileId}`;
}
