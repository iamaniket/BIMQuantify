import { redirect } from 'next/navigation';

/**
 * The free model list now lives inside the dashboard shell at `/projects` (the
 * free branch of the projects page). This legacy landing forwards there; the
 * immersive viewer keeps its own route at `/free-viewer/[id]`.
 */
export default function FreeViewerPage(): never {
  redirect('/projects');
}
