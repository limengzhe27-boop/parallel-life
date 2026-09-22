import 'server-only';
import { HttpError } from './http.ts';
export async function imageUploadForm(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data;'))
    throw new HttpError('INVALID_INPUT', 422);
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError('INVALID_INPUT', 422);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.length;
      if (total > 9 * 1024 * 1024) {
        await reader.cancel();
        throw new HttpError('INVALID_INPUT', 422);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  let form: FormData;
  try {
    form = await new Response(Buffer.concat(chunks), {
      headers: { 'Content-Type': request.headers.get('content-type')! },
    }).formData();
  } catch {
    throw new HttpError('INVALID_INPUT', 422);
  }
  return form;
}
