import type { Queryable } from '@/lib/db';
import { isLocalDemo } from '@/lib/local-demo';
import { createGeminiTextEmbedder } from './gemini-text-embedder';
import { createGeminiVisionExtractor } from './gemini-vision-extractor';
import { createDemoTextEmbedder, createDemoVisionExtractor } from './local-demo-models';

export function createTextEmbedder(db: Queryable) {
  return isLocalDemo() ? createDemoTextEmbedder(db) : createGeminiTextEmbedder(db);
}

export function createVisionExtractor(db: Queryable) {
  return isLocalDemo() ? createDemoVisionExtractor(db) : createGeminiVisionExtractor(db);
}
