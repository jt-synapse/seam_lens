// Match the catalog vision and gallery-classification 16 KiB input contracts.
// Streaming decode leaves a trailing partial UTF-8 character buffered.
export function catalogContext(parts: string[]): string {
  const bytes = Buffer.from(parts.join('\n'));
  return new TextDecoder().decode(bytes.subarray(0, 16 * 1024), { stream: true });
}
