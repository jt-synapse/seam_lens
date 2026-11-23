'use client';

import { createContext, useContext, type ReactNode } from 'react';

const DemoImages = createContext<Record<string, string> | null>(null);

export function DemoImagePreviews({images, children}: {images: Record<string, string>; children: ReactNode}) {
  return <DemoImages.Provider value={images}>{children}</DemoImages.Provider>;
}

// Real searches render their validated reference URL; demo references use only local artwork.
export function useImageUrlPreview(url: string | null) {
  const images = useContext(DemoImages);
  if (!url || !images) return url;
  return Object.hasOwn(images, url) ? images[url] : null;
}
