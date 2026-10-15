/** gzip + base64 for replay_chunk_v1.eventsData */

export async function gzipB64Encode(text) {
  if (typeof CompressionStream === 'undefined') {
    return btoa(unescape(encodeURIComponent(text)));
  }
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
