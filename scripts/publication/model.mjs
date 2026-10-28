import { createHash } from 'node:crypto';
import { readdir, readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';

export const EXPECTED_FILES = 28;
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export function digest(value) { return createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex'); }
export function assertRepository(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) throw new Error('Dépôt owner/name invalide.');
  return value;
}
export function assertBase(value) {
  if (value !== '/elan-app/') throw new Error('La publication autorisée exige le sous-chemin exact /elan-app/.');
  return value;
}
export function allowedArtifactPath(path) {
  return ['index.html', 'manifest.webmanifest', 'icon.svg', 'sw.js'].includes(path)
    || /^workbox-[A-Za-z0-9_-]+\.js$/.test(path)
    || /^pwa-resources-[A-Za-z0-9_-]+\.json$/.test(path)
    || /^assets\/[A-Za-z0-9_-]+\.(?:js|css)$/.test(path);
}
export async function listFiles(directory, prefix = '') {
  const results = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name), relative = prefix + name, info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Lien symbolique refusé : ${relative}.`);
    if (info.isDirectory()) results.push(...await listFiles(path, relative + '/'));
    else if (info.isFile()) results.push(relative);
    else throw new Error(`Fichier spécial refusé : ${relative}.`);
  }
  return results;
}
export function buildFingerprint(basePath, files) { return digest({ basePath, files }); }
export function validateMetadata(meta) {
  if (meta?.format !== 'elan-publication' || meta.version !== 1) throw new Error('Manifeste de publication inconnu.');
  assertBase(meta.basePath); assertRepository(meta.repository);
  if (!/^[a-f0-9]{40}$/.test(meta.repositoryBaseCommit ?? '') || !/^[a-f0-9]{64}$/.test(meta.sourceTreeSha256 ?? '') || meta.sourceWorkingTreeUncommitted !== true) throw new Error('Provenance de travail incomplète.');
  if (!Array.isArray(meta.files) || meta.files.length !== EXPECTED_FILES || meta.fileCount !== EXPECTED_FILES) throw new Error('Le paquet doit contenir exactement 28 fichiers applicatifs.');
  const paths = meta.files.map(file => file.path);
  if (new Set(paths).size !== paths.length || [...paths].sort().join('\n') !== paths.join('\n')) throw new Error('Chemins du manifeste dupliqués ou non triés.');
  for (const file of meta.files) if (!allowedArtifactPath(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 10_000_000 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error(`Ressource de publication invalide : ${file.path}.`);
  for (const required of ['index.html', 'manifest.webmanifest', 'icon.svg', 'sw.js']) if (!paths.includes(required)) throw new Error(`Ressource obligatoire absente : ${required}.`);
  if (paths.filter(path => path.startsWith('pwa-resources-')).length !== 1 || paths.filter(path => path.startsWith('workbox-')).length !== 1) throw new Error('Un manifeste de cache et un runtime Workbox exacts sont requis.');
  if (buildFingerprint(meta.basePath, meta.files) !== meta.buildSha256) throw new Error('Empreinte globale de build contradictoire.');
  return meta;
}
export async function inspectArtifact(directory, basePath = '/elan-app/') {
  assertBase(basePath);
  const names = await listFiles(directory);
  if (names.length !== EXPECTED_FILES || names.some(path => !allowedArtifactPath(path))) throw new Error('dist doit contenir exactement les 28 fichiers applicatifs autorisés, sans documents, profils ou sauvegardes.');
  const files = [];
  for (const path of names) { const bytes = await readFile(join(directory, path)); files.push({ path, bytes: bytes.length, sha256: digest(bytes) }); }
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.webmanifest'), 'utf8'));
  if (manifest.start_url !== basePath || manifest.scope !== basePath || !manifest.icons?.length || manifest.icons.some(icon => !icon.src.startsWith(basePath))) throw new Error('Manifeste PWA construit pour un autre sous-chemin. Relancer le build avec ELAN_BASE_PATH=/elan-app/.');
  const index = await readFile(join(directory, 'index.html'), 'utf8');
  for (const match of index.matchAll(/(?:src|href)=["'](\/[^"']*)["']/g)) if (!match[1].startsWith(basePath)) throw new Error(`Lien absolu hors /elan-app/ dans index.html : ${match[1]}.`);
  if (!index.includes(`${basePath}assets/`)) throw new Error('index.html ne référence pas les ressources sous /elan-app/.');
  const cachePath = names.find(path => path.startsWith('pwa-resources-'));
  const cache = JSON.parse(await readFile(join(directory, cachePath), 'utf8'));
  if (!/^[a-f0-9]{64}$/.test(cache.version ?? '') || !Array.isArray(cache.resources) || !cache.resources.length) throw new Error('Manifeste réel des ressources PWA invalide.');
  const byPath = new Map(files.map(file => [file.path, file]));
  const seen = new Set(); let total = 0;
  for (const resource of cache.resources) {
    if (typeof resource.url !== 'string' || !resource.url.startsWith(basePath)) throw new Error('Une ressource PWA sort du sous-chemin autorisé.');
    const path = resource.url.slice(basePath.length), file = byPath.get(path);
    if (!file || seen.has(path) || file.bytes !== resource.bytes || file.sha256 !== resource.sha256) throw new Error(`Empreinte ou taille PWA contradictoire : ${resource.url}.`);
    seen.add(path); total += file.bytes;
  }
  if (cache.totalBytes !== total) throw new Error('Taille cumulée du manifeste PWA contradictoire.');
  const sw = await readFile(join(directory, 'sw.js'), 'utf8');
  if (!sw.includes(`${basePath}index.html`)) throw new Error('Le fallback de navigation du service worker ne vise pas /elan-app/index.html.');
  return { files, buildSha256: buildFingerprint(basePath, files), resourceManifest: cachePath };
}
export async function verifyLocalArtifact(directory, meta) {
  validateMetadata(meta);
  const actual = await inspectArtifact(directory, meta.basePath);
  if (canonical(actual.files) !== canonical(meta.files) || actual.buildSha256 !== meta.buildSha256 || actual.resourceManifest !== meta.resourceManifest) throw new Error('site/ diffère du build manifesté.');
  return actual;
}
export function configuredBaseMatches(actual, expected = '/elan-app/') {
  assertBase(expected);
  if (actual !== '/elan-app' && actual !== '/elan-app/') throw new Error(`GitHub Pages annonce un base_path différent de /elan-app : ${JSON.stringify(actual)}. Aucun déploiement ne doit suivre.`);
  return true;
}
export function deploymentUrl(value, meta, allowHttpForTests = false) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== meta.basePath) throw new Error('page_url ne correspond pas au sous-chemin prévu.');
  if (allowHttpForTests) {
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Le transport de test doit rester HTTP sur boucle locale.');
  } else {
    const host = meta.repository.split('/')[0].toLowerCase() + '.github.io';
    if (url.protocol !== 'https:' || url.hostname !== host || url.port) throw new Error('page_url doit être l’adresse HTTPS GitHub Pages attendue.');
  }
  return url;
}
