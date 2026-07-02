/**
 * The scroll story's step → scene mapping. Data only, no React — the section
 * shell derives `activeStep` from scroll progress and StoryViewer translates
 * each step into viewer commands (`story.applyStep`, `entity-marker.sync`,
 * `story.setCut`).
 *
 * Camera poses are RELATIVE (`azimuthDeg`/`polarDeg`/`distanceFactor` off the
 * live scene box), never absolute world coordinates — the snag pins land on
 * arbitrary geometry and the demo model may be swapped, so relative poses
 * survive a model swap. Tune the angles via the existing `?camdebug` gate
 * (`window.__storyViewer.commands.execute('showcase.debug.snapshot')`).
 */

export type StoryStepKey = 'step1' | 'step2' | 'step3' | 'step4' | 'step5' | 'step6';

export type StoryCamera = {
  azimuthDeg: number;
  polarDeg: number;
  /** Multiplier on the sphere-fit distance (1 = plain fit, <1 = closer). */
  distanceFactor: number;
  /** Aim at the featured snag anchor instead of the model center. */
  lookAtAnchor?: boolean;
};

export type StoryStep = {
  key: StoryStepKey;
  camera: StoryCamera;
  /** Which pins are synced when this step becomes active. */
  markers: 'none' | 'snags' | 'snags+docs' | 'verified';
  /** Cut plane behaviour while this step is active. */
  cut: 'none' | 'scrub' | 'hold';
  /** Show the popover card over the featured pin. */
  spotlight?: boolean;
};

export const STORY_STEPS: readonly StoryStep[] = [
  { key: 'step1', camera: { azimuthDeg: 40,  polarDeg: 68, distanceFactor: 1.05 }, markers: 'none',      cut: 'none' },              // establishing shot
  { key: 'step2', camera: { azimuthDeg: 40,  polarDeg: 18, distanceFactor: 0.95 }, markers: 'none',      cut: 'none' },              // near-plan view: "drawing becomes model"
  { key: 'step3', camera: { azimuthDeg: 65,  polarDeg: 80, distanceFactor: 0.45, lookAtAnchor: true }, markers: 'snags', cut: 'none', spotlight: true }, // dive to a pin, card pops
  { key: 'step4', camera: { azimuthDeg: 115, polarDeg: 72, distanceFactor: 0.75 }, markers: 'snags+docs', cut: 'none' },             // certificate/attachment markers join
  { key: 'step5', camera: { azimuthDeg: 205, polarDeg: 55, distanceFactor: 0.9 },  markers: 'snags+docs', cut: 'scrub' },            // dollhouse cut sweeps with scroll
  { key: 'step6', camera: { azimuthDeg: 320, polarDeg: 66, distanceFactor: 1.0 },  markers: 'verified',   cut: 'none' },             // cut heals, pins restyle green
];

/**
 * Document markers that join the snags at step 4 ("add your documents") —
 * certificate / site-photo pins in the entity-marker plugin's real cert /
 * attachment styles. Positions come from the same on-model surface sampling as
 * the snags (`showcase.elementPoints`); labels resolve through
 * `howItWorks.story.<labelKey>`.
 */
export type StoryDocMarker = {
  id: string;
  type: 'certificate' | 'attachment';
  labelKey: 'docCertificate' | 'docPhoto';
};

export const STORY_DOC_MARKERS: readonly StoryDocMarker[] = [
  { id: 'doc-cert-1', type: 'certificate', labelKey: 'docCertificate' },
  { id: 'doc-photo-1', type: 'attachment', labelKey: 'docPhoto' },
  { id: 'doc-cert-2', type: 'certificate', labelKey: 'docCertificate' },
];
