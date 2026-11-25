export const isStandalone = location.protocol === "file:" || Boolean(document.getElementById("asset-location"));

export async function readAsset(url, id) {
  if (!isStandalone) return fetch(url);
  const encoded = document.getElementById("asset-" + id).textContent;
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream);
}
