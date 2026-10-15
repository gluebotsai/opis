/** Optional payload compression via CompressionStream (gzip). */

export async function compressJson(jsonString) {
  if (typeof CompressionStream === 'undefined' || typeof TextEncoder === 'undefined') {
    return { body: jsonString, encoding: null };
  }
  try {
    const stream = new Blob([jsonString]).stream().pipeThrough(new CompressionStream('gzip'));
    const buffer = await new Response(stream).arrayBuffer();
    return { body: buffer, encoding: 'gzip' };
  } catch {
    return { body: jsonString, encoding: null };
  }
}

export function payloadByteLength(body, encoding) {
  if (encoding === 'gzip' && body instanceof ArrayBuffer) return body.byteLength;
  return typeof body === 'string' ? body.length : 0;
}
