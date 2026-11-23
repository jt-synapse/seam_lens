// Leave room for multipart boundaries and form fields within Vercel's default 4.5 MB body limit.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_MULTIPART_BYTES = 4_500_000;
