import { getConfig } from '../config.js';
import { logger } from '../log.js';

export type CallbackStatus = 'running' | 'succeeded' | 'failed';

export type CallbackPayload = {
  file_id: string;
  // Schema-per-tenant routing key. The worker receives it on the dispatch
  // envelope from the API and echoes it back so the API can resolve the
  // tenant schema for the write.
  organization_id: string;
  job_id?: string;
  status: CallbackStatus;
  fragments_key?: string;
  metadata_key?: string;
  properties_key?: string;
  // Set only on `succeeded` when the outline artifact uploaded; absent for
  // pre-outline extractions and when outline generation failed gracefully
  // (the viewer falls back to client-side edge compute either way).
  outline_key?: string | null;
  // Set only on `succeeded` when the per-level floor-plan artifact uploaded;
  // absent when the model has no storeys or generation failed gracefully.
  floor_plans_key?: string | null;
  // Content-based discipline classification of the model (architectural /
  // structural / mep / mixed / none), persisted on the file. Drives the
  // floor-plan gate and the portal's discipline badge + federated 2D source.
  detected_kind?: string | null;
  geometry_key?: string;
  page_count?: number;
  error?: string;
  extractor_version?: string;
  started_at?: string;
  finished_at?: string;
  content_sha256?: string;
  ifc_project_guid?: string;
  // 0-100 progress reported on `running` callbacks.
  progress?: number;
  // Failure classification, set on `failed` callbacks (see pipeline/errors.ts).
  retriable?: boolean;
  error_kind?: string;
};

export async function postCallback(payload: CallbackPayload): Promise<void> {
  const cfg = getConfig();
  const url = `${cfg.API_BASE_URL.replace(/\/$/, '')}/internal/jobs/callback`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.PROCESSOR_SHARED_SECRET}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    logger.error(
      { status: response.status, body: text.slice(0, 500), payload },
      'callback to API failed',
    );
    throw new Error(`callback ${url} returned ${response.status}`);
  }
}
