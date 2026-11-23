import type { FocusRegion } from '@/modules/taxonomy/construction-profile';
import type { SearchFilters } from './hybrid-ranker';
import type { CropBox } from './image-ingest';
import { MAX_UPLOAD_BYTES } from './upload-limits';

export async function preprocessGarmentFileInBrowser(file: File, cropBox?: CropBox | null):
  Promise<{ blob: Blob; previewDataUrl: string }> {
  if (/\.hei[cf]$/i.test(file.name) || /^image\/hei[cf](?:-sequence)?$/i.test(file.type)) {
    throw new Error('Upload a JPEG, PNG, WebP, or screenshot of your garment.');
  }
  const crop = cropBox ?? { x: 0, y: 0, width: 1, height: 1 };
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite)
      || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0
      || crop.x + crop.width > 1 || crop.y + crop.height > 1) {
    throw new Error('Keep the crop inside the image.');
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const x = Math.floor(crop.x * bitmap.width);
    const y = Math.floor(crop.y * bitmap.height);
    const width = Math.ceil((crop.x + crop.width) * bitmap.width) - x;
    const height = Math.ceil((crop.y + crop.height) * bitmap.height) - y;
    const scale = Math.min(1, 1280 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(scale * width));
    canvas.height = Math.max(1, Math.round(scale * height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Your browser could not prepare the image.');
    ctx.drawImage(bitmap, x, y, width, height, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(value => {
        if (value?.type === 'image/webp' && value.size) resolve(value);
        else reject(new Error('Your browser could not export this image as WebP.'));
      }, 'image/webp', 0.82);
    });
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error('Choose a smaller image or crop closer to the garment.');
    const previewDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read the garment preview.'));
      reader.readAsDataURL(blob);
    });
    return { blob, previewDataUrl };
  } finally {
    bitmap.close();
  }
}

export function buildPreparedUploadForm(blob: Blob, focusRegion: FocusRegion, filters: SearchFilters): FormData {
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('Choose a smaller image or crop closer to the garment.');
  const form = new FormData();
  form.set('file', blob, 'garment.webp');
  form.set('focusRegion', focusRegion);
  form.set('filters', JSON.stringify(filters));
  return form;
}
