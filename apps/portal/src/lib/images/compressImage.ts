/**
 * Shared client-side image-compression helpers.
 *
 * Extracted out of `features/projects/ProjectFormDialog.tsx` so the same
 * pipeline (canvas downscale → JPEG 0.82) can be reused by other dialogs
 * (e.g. the bilingual blog-post create wizard) without duplicating the
 * size/dim/MIME knobs.
 */

export const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const THUMBNAIL_MAX_DIM = 800;
export const THUMBNAIL_ACCEPT = 'image/jpeg,image/png,image/webp';

export async function compressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const blobUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(blobUrl);
      let { width, height } = img;
      if (width > THUMBNAIL_MAX_DIM) {
        height = Math.round((height * THUMBNAIL_MAX_DIM) / width);
        width = THUMBNAIL_MAX_DIM;
      }
      if (height > THUMBNAIL_MAX_DIM) {
        width = Math.round((width * THUMBNAIL_MAX_DIM) / height);
        height = THUMBNAIL_MAX_DIM;
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
        0.82,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(blobUrl); reject(new Error('Load failed')); };
    img.src = blobUrl;
  });
}
