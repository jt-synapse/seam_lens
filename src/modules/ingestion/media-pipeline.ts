import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { IngestionWorkerDeps, PreparedGalleryView } from './chunk-worker';
import { catalogContext } from './catalog-context';
import type { GalleryClassifier } from './gallery-classifier';

type Role = PreparedGalleryView['images'][number]['role'];
type Dependencies = {
  fetchImage(url: string): Promise<Buffer>;
  write(key: string, bytes: Buffer): Promise<string>;
  classify: GalleryClassifier;
};
type Assignment = { url: string; role: Role; viewCode: string; viewLabel: string };

const MAX_GALLERY_IMAGES = 24;
const MAX_PREVIEW_BYTES = 6 * 1024 * 1024;
const MAX_GALLERY_BYTES = 32 * 1024 * 1024;

function digest(bytes: Buffer | string) {
  return createHash('sha256').update(bytes).digest('hex');
}

function pathSegment(value: string) {
  return /^[a-z0-9][a-z0-9_-]{0,127}$/i.test(value) ? value : digest(value);
}

export function createGalleryPreparer(deps: Dependencies): IngestionWorkerDeps['prepareGallery'] {
  return async ({ draft, makerSlug, patternSlug, assertActive }) => {
    const urls = [...new Set(draft.imageUrls.map(image => image.url))];
    if (!urls.length || urls.length > MAX_GALLERY_IMAGES) throw new Error('Gallery requires 1–24 distinct images');
    const fullImages = new Map<string, Buffer>();
    let galleryBytes = 0;
    for (const url of urls) {
      await assertActive();
      const raw = await deps.fetchImage(url);
      if (!raw.length || raw.length > 8 * 1024 * 1024) throw new Error('Invalid source image size');
      const full = await sharp(raw, { limitInputPixels: 40_000_000, failOn: 'warning' })
        .rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 84 }).toBuffer();
      galleryBytes += full.length;
      if (galleryBytes > MAX_GALLERY_BYTES) throw new Error('Normalized gallery exceeds 32 MiB');
      fullImages.set(url, full);
    }

    const assignments: Assignment[] = [];
    const labels = new Map(draft.explicitViews?.map(view => [view.viewCode, view.viewLabel]));
    const fallbackView = draft.explicitViews?.[0]?.viewCode ?? 'default';
    for (const image of draft.imageUrls) {
      if (!image.roleHint) continue;
      const viewCode = image.viewCode || fallbackView;
      assignments.push({ url: image.url, role: image.roleHint, viewCode, viewLabel: labels.get(viewCode) ?? viewCode });
    }

    const known = new Set(assignments.map(a => a.url));
    const unknown = urls.filter(url => !known.has(url));
    if (unknown.length) {
      const images = [];
      let previewBytes = 0;
      for (const url of unknown) {
        const bytes = await sharp(fullImages.get(url)!).resize({
          width: 512, height: 512, fit: 'inside', withoutEnlargement: true,
        }).webp({ quality: 72 }).toBuffer();
        previewBytes += bytes.length;
        if (previewBytes > MAX_PREVIEW_BYTES) throw new Error('Gallery previews exceed 6 MiB');
        images.push({ bytes, mimeType: 'image/webp' });
      }
      const contextText = catalogContext([
        draft.title, ...Array.from(labels, ([code, label]) => code + ': ' + label), draft.descriptionHtml,
      ]);
      await assertActive();
      const classified = await deps.classify({ images, contextText });
      for (const item of classified) {
        if (item.role === 'ignore') continue;
        const url = unknown[item.index];
        if (!url) throw new Error('Unknown gallery image index');
        assignments.push({ url, role: item.role, viewCode: item.viewCode, viewLabel: labels.get(item.viewCode) ?? item.viewLabel });
      }
    }

    const views = new Map<string, PreparedGalleryView>();
    for (const assignment of assignments) {
      const { viewCode, viewLabel, role, url } = assignment;
      const view = views.get(viewCode) ?? { viewCode, viewLabel, images: [] };
      if (view.images.some(image => image.role === role)) continue;
      const bytes = fullImages.get(url)!;
      const card = await sharp(bytes).resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      const assetId = createHash('sha256').update(digest(bytes)).update(digest(card)).digest('hex');
      const prefix = [makerSlug, patternSlug, viewCode].map(pathSegment).join('/') + '/' + role + '-' + assetId;
      await assertActive();
      const fullPath = await deps.write(prefix + '-full.webp', bytes);
      await assertActive();
      const cardPath = await deps.write(prefix + '-card.webp', card);
      view.images.push({ role, bytes, mimeType: 'image/webp', fullPath, cardPath });
      views.set(viewCode, view);
    }
    if (!views.size || draft.explicitViews?.some(v => !views.has(v.viewCode))) {
      throw new Error('A garment view has no usable gallery image');
    }
    return Array.from(views.values());
  };
}
