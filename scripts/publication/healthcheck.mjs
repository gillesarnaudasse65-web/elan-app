import { digest, deploymentUrl, validateMetadata } from './model.mjs';

async function fetchHash(url, file, { fetchImpl, timeoutMs }) {
  const response = await fetchImpl(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs), headers: { 'Accept-Encoding': 'identity', 'User-Agent': 'Elan-publication-verification' } });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  const chunks = []; let length = 0;
  for await (const chunk of response.body) { length += chunk.byteLength; if (length > file.bytes) { await response.body.cancel?.().catch(() => {}); throw new Error('Taille supérieure au build attendu'); } chunks.push(Buffer.from(chunk)); }
  if (length !== file.bytes) throw new Error('Taille différente du build attendu');
  const hash = digest(Buffer.concat(chunks));
  if (hash !== file.sha256) throw new Error('SHA256 différent du build attendu');
  return { status: 200, bytes: length, sha256: hash };
}
/** Aucun CLI ne permet HTTP. L’injection explicite est réservée aux serveurs de test locaux. */
export async function verifyDeployment(meta, pageUrl, options = {}) {
  validateMetadata(meta);
  const base = deploymentUrl(pageUrl, meta, options.allowHttpForTests === true);
  const fetchImpl = options.fetchImpl ?? fetch, timeoutMs = options.timeoutMs ?? 20000;
  const waits = options.retryDelays ?? [0, 1000, 2000];
  const pause = options.pause ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const index = meta.files.find(file => file.path === 'index.html');
  const expected = [{ ...index, path: '', label: '(page_url)' }, ...meta.files];
  const results = new Array(expected.length); let cursor = 0;
  async function worker() {
    while (cursor < expected.length) {
      const index = cursor++, file = expected[index], target = new URL(file.path, base);
      target.searchParams.set('elan_build', meta.buildSha256);
      let result;
      for (let attempt = 0; attempt < waits.length; attempt++) {
        if (waits[attempt]) await pause(waits[attempt]);
        try { result = { path: file.label ?? file.path, passed: true, attempts: attempt + 1, ...await fetchHash(target, file, { fetchImpl, timeoutMs }) }; break; }
        catch (error) { result = { path: file.label ?? file.path, passed: false, attempts: attempt + 1, error: error.message }; }
      }
      results[index] = result;
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, expected.length) }, worker));
  return { passed: results.every(result => result?.passed === true), verifiedURL: results.every(result => result?.passed === true) ? base.href : null, checkedURL: base.href, resources: results };
}
