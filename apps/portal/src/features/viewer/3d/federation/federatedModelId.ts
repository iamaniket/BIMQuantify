/**
 * Deterministic viewer model id for a project file in the federated viewer.
 * Used by both the route (when building each `ViewerBundle.modelId`) and the
 * layer panel (when dispatching `model:setVisible`) so the two never drift.
 *
 * Re-exported from @bimdossier/contracts so the portal and the mobile viewer
 * (apps/mobile) compute the SAME id — finding anchors authored in either client
 * must re-base onto the same model.
 */
export { federatedModelId } from '@bimdossier/contracts';
