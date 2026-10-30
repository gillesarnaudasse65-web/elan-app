import { createHash } from 'node:crypto';
import { readdir, readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';

export const APK_PATH = 'downloads/elan-android-v0.2.0.apk';
export const ANDROID_METADATA_PATH = 'android-release.json';
export const MAX_APK_BYTES = 50_000_000;
export const MAX_WEB_FILES = 128;
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
  return ['index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'sw.js', ANDROID_METADATA_PATH, APK_PATH].includes(path)
    || /^workbox-[A-Za-z0-9_-]+\.js$/.test(path)
    || /^pwa-resources-[A-Za-z0-9_-]+\.json$/.test(path)
    || /^assets\/[A-Za-z0-9_-]+\.(?:js|css|png|svg|webp|woff2)$/.test(path);
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

export function validateAndroidRelease(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['name', 'version', 'minAndroid', 'bytes', 'sha256', 'url'].includes(key))
    || value.version !== '0.2.0' || value.url !== APK_PATH || !Number.isInteger(value.minAndroid) || value.minAndroid < 1 || value.minAndroid > 100
    || !Number.isSafeInteger(value.bytes) || value.bytes < 4 || value.bytes > MAX_APK_BYTES || !/^[a-f0-9]{64}$/.test(value.sha256 ?? '')
    || (value.name !== undefined && (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80))) throw new Error('Métadonnées Android invalides.');
  return value;
}

export function validateMetadata(meta) {
  if (meta?.format !== 'elan-publication' || meta.version !== 2) throw new Error('Manifeste de publication inconnu.');
  assertBase(meta.basePath); assertRepository(meta.repository);
  if (meta.repository !== 'gillesarnaudasse65-web/elan-app') throw new Error('Dépôt de publication étranger.');
  if (!/^[a-f0-9]{40}$/.test(meta.repositoryBaseCommit ?? '') || !/^[a-f0-9]{64}$/.test(meta.sourceTreeSha256 ?? '') || meta.sourceWorkingTreeUncommitted !== true) throw new Error('Provenance de travail incomplète.');
  if (!Array.isArray(meta.files) || meta.files.length < 10 || meta.files.length > MAX_WEB_FILES + 2 || meta.fileCount !== meta.files.length || meta.webFileCount !== meta.fileCount - 2) throw new Error('Le nombre gelé de fichiers web et Android est contradictoire.');
  const paths = meta.files.map(file => file.path);
  if (new Set(paths).size !== paths.length || [...paths].sort().join('\n') !== paths.join('\n')) throw new Error('Chemins du manifeste dupliqués ou non triés.');
  for (const file of meta.files) if (!allowedArtifactPath(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > (file.path === APK_PATH ? MAX_APK_BYTES : 10_000_000) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error(`Ressource de publication invalide : ${file.path}.`);
  for (const required of ['index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'sw.js', ANDROID_METADATA_PATH, APK_PATH]) if (!paths.includes(required)) throw new Error(`Ressource obligatoire absente : ${required}.`);
  if (paths.filter(path => path.startsWith('pwa-resources-')).length !== 1 || paths.filter(path => path.startsWith('workbox-')).length !== 1) throw new Error('Un manifeste de cache et un runtime Workbox exacts sont requis.');
  validateAndroidRelease(meta.androidRelease);
  const apk = meta.files.find(file => file.path === APK_PATH);
  if (apk.bytes !== meta.androidRelease.bytes || apk.sha256 !== meta.androidRelease.sha256) throw new Error('APK et métadonnées Android contradictoires.');
  if (buildFingerprint(meta.basePath, meta.files) !== meta.buildSha256) throw new Error('Empreinte globale de build contradictoire.');
  return meta;
}
export async function inspectArtifact(directory, basePath = '/elan-app/', includeAndroid = false) {
  assertBase(basePath);
  const names = await listFiles(directory);
  if (names.length < 8 || names.length > MAX_WEB_FILES + (includeAndroid ? 2 : 0) || names.some(path => !allowedArtifactPath(path) || (!includeAndroid && [APK_PATH, ANDROID_METADATA_PATH].includes(path)))) throw new Error('Le paquet contient un chemin, un nombre de fichiers ou une ressource Android non autorisés.');
  const files = [];
  for (const path of names) { const info = await lstat(join(directory, path)); if (info.size < 1 || info.size > (path === APK_PATH ? MAX_APK_BYTES : 10_000_000)) throw new Error('Ressource hors budget : ' + path); const bytes = await readFile(join(directory, path)); files.push({ path, bytes: bytes.length, sha256: digest(bytes) }); }
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
    if (typeof resource.url !== 'string' || !resource.url.startsWith(basePath) || [APK_PATH, ANDROID_METADATA_PATH].includes(resource.url.slice(basePath.length))) throw new Error('Une ressource PWA sort du sous-chemin autorisé.');
    const path = resource.url.slice(basePath.length), file = byPath.get(path);
    if (!file || seen.has(path) || file.bytes !== resource.bytes || file.sha256 !== resource.sha256) throw new Error(`Empreinte ou taille PWA contradictoire : ${resource.url}.`);
    seen.add(path); total += file.bytes;
  }
  for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512]]) {
    const image = await readFile(join(directory, name));
    if (!seen.has(name) || image.length < 24 || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || image.readUInt32BE(16) !== size || image.readUInt32BE(20) !== size || !manifest.icons.some(icon => icon.src === basePath + name && icon.sizes === `${size}x${size}`)) throw new Error('Icône PNG absente, non précachée ou de dimensions incohérentes : ' + name);
  }
  if (cache.totalBytes !== total) throw new Error('Taille cumulée du manifeste PWA contradictoire.');
  const sw = await readFile(join(directory, 'sw.js'), 'utf8');
  if (!sw.includes(`${basePath}index.html`)) throw new Error('Le fallback de navigation du service worker ne vise pas /elan-app/index.html.');
  let androidRelease;
  if (includeAndroid) {
    androidRelease = validateAndroidRelease(JSON.parse(await readFile(join(directory, ANDROID_METADATA_PATH), 'utf8')));
    const apk = files.find(file => file.path === APK_PATH);
    if (!apk || apk.bytes !== androidRelease.bytes || apk.sha256 !== androidRelease.sha256) throw new Error('Le fichier APK diffère des métadonnées Android.');
    const bytes = await readFile(join(directory, APK_PATH));
    if (!bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error('Conteneur APK/ZIP invalide.');
    if (sw.includes(APK_PATH) || sw.includes(ANDROID_METADATA_PATH)) throw new Error('Le téléchargement Android ne doit pas être précaché par le service worker.');
  }
  return { files, buildSha256: buildFingerprint(basePath, files), resourceManifest: cachePath, webFileCount: files.length - (includeAndroid ? 2 : 0), ...(androidRelease ? { androidRelease } : {}) };
}
export async function verifyLocalArtifact(directory, meta) {
  validateMetadata(meta);
  const actual = await inspectArtifact(directory, meta.basePath, true);
  if (canonical(actual.files) !== canonical(meta.files) || actual.buildSha256 !== meta.buildSha256 || actual.resourceManifest !== meta.resourceManifest || canonical(actual.androidRelease) !== canonical(meta.androidRelease)) throw new Error('site/ diffère du build manifesté.');
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
