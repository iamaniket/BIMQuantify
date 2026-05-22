/**
 * Shared run-state singleton for the multitenant E2E journey.
 *
 * All 23 tests run in a single describe.serial block inside the same
 * Node.js worker process, so a plain module-level object is safe for
 * passing data between sequential tests (org name → activation link →
 * project name, etc.).
 */
export const state = {
  /** Base-36 timestamp suffix — makes generated emails unique per run. */
  runId: Date.now().toString(36),

  // --- Suite A: written by super-admin org-creation test ---
  orgName: '',
  adminEmail: '',

  // --- Suite B: written by activation test, read by login test ---
  /** Hardcoded password set during activation. */
  adminPassword: 'Passw0rd!E2E',
  _activationPath: '',

  // --- Suite C: written by invite + project-creation tests ---
  memberEmail: '',
  /** Hardcoded password set during member activation. */
  memberPassword: 'Passw0rd!M3mb',
  projectName: '',

  // --- Suite D: written by member-invite extraction test ---
  _memberInvitePath: '',

  // --- Suite E/F: forgot-password reset paths (written by MailHog extraction) ---
  _memberResetPath: '',
  _adminResetPath: '',

  // --- Suite G-J: project-scoped invitation tests ---
  projectId: '',
  guestEmail: '',
  guestFullName: '',
  guestPassword: 'Passw0rd!Gu3st',
  _guestActivationPath: '',
};
