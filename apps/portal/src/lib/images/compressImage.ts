/**
 * Shared client-side image-compression helpers.
 *
 * Extracted out of `features/projects/ProjectFormDialog.tsx` so the same
 * pipeline (canvas downscale → JPEG re-encode) can be reused by other dialogs
 * (e.g. the bilingual blog-post create wizard) without duplicating the
 * size/dim/MIME knobs.
 *
 * The dimension + quality are now caller-tunable. The defaults match the
 * original project-thumbnail tuning (small avatar-ish chip, so 800px / 0.82 is
 * fine). A full-bleed surface — like a blog cover that renders into a ~1152px
 * slot (≈2304px on a 2× display) — MUST pass a larger `maxDim`/`quality`, or the
 * 800px output gets upscaled by the browser and looks drastically soft.
 */

export const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const THUMBNAIL_MAX_DIM = 800;
export const THUMBNAIL_QUALITY = 0.82;
export const THUMBNAIL_ACCEPT = 'image/jpeg,image/png,image/webp';

// Blog covers render full-bleed into a 1152px slot (2304px @2×). Keep enough
// pixels to stay sharp on retina, and bump the JPEG quality so detailed
// photography doesn't show compression mush. ~2048px @0.9 lands well under the
// API's 5 MB upload ceiling for typical photos.
export const BLOG_COVER_MAX_DIM = 2048;
export const BLOG_COVER_QUALITY = 0.9;

export type CompressImageOptions = {
  /** Longest-edge cap in px. Larger images are scaled down to fit. Default 800. */
  maxDim?: number;
  /** JPEG quality 0–1. Default 0.82. */
  quality?: number;
};

export async function compressImage(
  file: File,
  options: CompressImageOptions = {},
): Promise<File> {
  const maxDim = options.maxDim ?? THUMBNAIL_MAX_DIM;
  const quality = options.quality ?? THUMBNAIL_QUALITY;
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const blobUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(blobUrl);
      let { width, height } = img;
      if (width > maxDim) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      }
      if (height > maxDim) {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx === null) { reject(new Error('Canvas unavailable')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob === null) { reject(new Error('Encode failed')); return; }
          const outName = file.name.replace(/\.[^.]+$/, '.jpg');
          resolve(new File([blob], outName, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(blobUrl); reject(new Error('Load failed')); };
    img.src = blobUrl;
  });
}
