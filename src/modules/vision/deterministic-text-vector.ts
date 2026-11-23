import { VECTOR_DIMENSION } from '../../lib/db';

const BOILERPLATE_KEYS = new Set<string>([
  'region',
  'full_silhouette',
  'bodice_neckline',
  'sleeves_armscye',
  'skirt_hemline',
  'notes',
  'category',
  'substrate',
  'silhouette',
  'ease',
  'length',
  'neckline',
  'collar',
  'shaping',
  'waist_definition',
  'back_detail',
  'armscye',
  'sleeve',
  'skirt',
  'tiers',
  'slit',
  'hem',
  'pockets',
  'closure',
  'finish',
  'sleeve_style',
  'sleeve_length',
  'cuff_finish',
  'skirt_construction',
  'tier_count',
  'slit_detail',
  'hemline_shape',
  'garment_length',
  'none',
  'unknown',
]);

function fnv1a32(input: string, seedOffset: number): number {
  let hash = (0x811c9dc5 ^ seedOffset) >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function addHashedFeature(vec: Float64Array, feature: string, weight: number): void {
  const h1 = fnv1a32(feature, 0x9e3779b1);
  const h2 = fnv1a32(feature, 0x85ebca6b);
  const idx = h1 % VECTOR_DIMENSION;
  const sign = (h2 & 1) === 0 ? 1 : -1;
  vec[idx] += sign * weight;

  // Dual projection stabilizes low-token-count texts against hash collisions
  const idx2 = (h2 >>> 1) % VECTOR_DIMENSION;
  const sign2 = (h1 & 2) === 0 ? 1 : -1;
  vec[idx2] += sign2 * (weight * 0.5);
}

/**
 * Deterministically maps canonical construction text to an L2-normalized 768-d vector
 * using signed feature hashing over structural tokens, sub-tokens, and bigrams.
 */
export function deterministicTextToVector768(text: string): number[] {
  const vec = new Float64Array(VECTOR_DIMENSION);
  const rawTokens = text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const semanticTokens = rawTokens.filter((token) => !BOILERPLATE_KEYS.has(token));
  const activeTokens = semanticTokens.length > 0 ? semanticTokens : rawTokens;

  for (let i = 0; i < activeTokens.length; i += 1) {
    const token = activeTokens[i];
    addHashedFeature(vec, `tok:${token}`, 2.5);

    if (token.includes('_')) {
      const subTokens = token.split('_').filter(Boolean);
      for (const sub of subTokens) {
        if (!BOILERPLATE_KEYS.has(sub)) {
          addHashedFeature(vec, `sub:${sub}`, 1.0);
        }
      }
    }

    if (i + 1 < activeTokens.length) {
      addHashedFeature(vec, `bi:${token}|${activeTokens[i + 1]}`, 2.0);
    }

    if (token.length >= 4) {
      for (let c = 0; c <= token.length - 4; c += 1) {
        addHashedFeature(vec, `cg:${token.slice(c, c + 4)}`, 0.3);
      }
    }
  }

  let normSq = 0;
  for (let i = 0; i < vec.length; i += 1) {
    normSq += vec[i] * vec[i];
  }

  if (normSq === 0) {
    const fallback = new Array<number>(VECTOR_DIMENSION).fill(0);
    fallback[0] = 1;
    return fallback;
  }

  const norm = Math.sqrt(normSq);
  return Array.from(vec, (v) => v / norm);
}
