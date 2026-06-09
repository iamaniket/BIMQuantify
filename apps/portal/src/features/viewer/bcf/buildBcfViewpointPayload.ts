import type { BcfViewpointRead } from '@/lib/api/schemas/bcf';

export function buildBcfViewpointPayload(vp: BcfViewpointRead): Record<string, unknown> {
  const cam = {
    type: vp.camera_type as 'perspective' | 'orthographic',
    viewPoint: vp.camera_view_point as { x: number; y: number; z: number },
    direction: vp.camera_direction as { x: number; y: number; z: number },
    upVector: vp.camera_up_vector as { x: number; y: number; z: number },
    fieldOfView: vp.field_of_view ?? undefined,
    fieldOfHeight: vp.field_of_height ?? undefined,
  };

  const vpData: Record<string, unknown> = { camera: cam };

  if (vp.components !== null) {
    const comp = vp.components as Record<string, unknown>;
    vpData['components'] = {
      visibility: {
        defaultVisibility: comp['default_visibility'] ?? true,
        exceptions: comp['visibility_exceptions'] ?? [],
      },
      selection: comp['selection'] ?? [],
    };
  }

  if (vp.clipping_planes !== null && Array.isArray(vp.clipping_planes)) {
    vpData['clippingPlanes'] = vp.clipping_planes;
  }

  if (vp.xray !== null && vp.xray !== undefined) {
    const x = vp.xray as {
      items?: string[];
      opacity_overrides?: Array<{ global_id: string; opacity: number }>;
    };
    vpData['xray'] = {
      items: x.items ?? [],
      opacityOverrides: (x.opacity_overrides ?? []).map((o) => ({
        globalId: o.global_id,
        opacity: o.opacity,
      })),
    };
  }

  if (Array.isArray(vp.measurements)) {
    // Inner keys (type/points/height) match the viewer shape verbatim.
    vpData['measurements'] = vp.measurements;
  }

  return vpData;
}
