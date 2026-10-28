import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

// Production always targets this one public site. The explicit local-only mode
// is for exercising this recipe against the exact artifact before committing CI.
const PUBLIC_URL = 'https://gillesarnaudasse65-web.github.io/elan-app/';
const local = process.env.ELAN_SMOKE_LOCAL_TEST === '1';
if (local && process.env.GITHUB_ACTIONS === 'true') throw new Error('Local recipe mode is forbidden in GitHub Actions.');
const baseURL = local ? 'http://127.0.0.1:4191/elan-app/' : PUBLIC_URL;
const mount = '/elan-app/';
const origin = new URL(baseURL).origin;
const packageRoot = resolve(process.env.ELAN_SMOKE_PACKAGE_ROOT ?? '.');
const outputDir = resolve(process.env.ELAN_SMOKE_OUTPUT_DIR ?? 'public-browser-evidence');
const digest = data => createHash('sha256').update(data).digest('hex');
const nickname = 'Recette publique fictive';
const proof = {
  format: 'elan-public-browser-recipe', version: 1,
  createdAt: new Date().toISOString(), passed: false,
  repository: process.env.GITHUB_REPOSITORY ?? 'gillesarnaudasse65-web/elan-app',
  url: baseURL, checkedURL: baseURL, deployedToPublicURL: !local,
  physicalDeviceTested: false, execution: 'automated-isolated-browser',
  sourceCommit: process.env.GITHUB_SHA ?? null,
  workflowRunId: process.env.GITHUB_RUN_ID ?? null,
};
await mkdir(outputDir, { recursive: true });
let browser;
let page;
const errors = [];

async function store(name) {
  return page.evaluate(name => new Promise((resolve, reject) => {
    const opening = indexedDB.open('elan-local');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      const request = database.transaction(name, 'readonly').objectStore(name).getAll();
      request.onsuccess = () => { resolve(request.result); database.close(); };
      request.onerror = () => { reject(request.error); database.close(); };
    };
  }), name);
}

async function navigate(name) {
  const buttons = page.getByRole('button', { name, exact: true });
  await buttons.first().waitFor({ state: 'attached' });
  for (const button of await buttons.all()) {
    if (await button.isVisible()) { await button.click(); return; }
  }
  throw new Error(`Visible navigation absent: ${name}`);
}

try {
  const meta = JSON.parse(await readFile(resolve(packageRoot, 'publication-meta.json'), 'utf8'));
  assert.equal(meta.repository, 'gillesarnaudasse65-web/elan-app');
  assert.equal(proof.repository, meta.repository);
  if (!local) assert.match(proof.sourceCommit ?? '', /^[a-f0-9]{40}$/);
  assert.equal(meta.basePath, mount);
  assert.equal(meta.fileCount, 28);
  assert.equal(meta.buildSha256, '9041c98afe9294314f6e09734e56b632e05f31d64c5233b1b838cccc88f8765c');
  proof.buildSha256 = meta.buildSha256;
  const byPath = new Map(meta.files.map(file => [file.path, file]));
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  proof.browserVersion = browser.version();
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 }, locale: 'fr-FR',
    acceptDownloads: true, serviceWorkers: 'allow',
  });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(45000);
  page.on('pageerror', error => errors.push(error.message.slice(0, 1500)));
  const landing = await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  assert.equal(landing.status(), 200);
  assert.equal(page.url(), baseURL);
  assert.equal(digest(await landing.body()), byPath.get('index.html').sha256);
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  assert.ok(manifestHref);
  const manifestURL = new URL(manifestHref, page.url());
  assert.equal(manifestURL.origin, origin);
  assert.ok(manifestURL.pathname.startsWith(mount));
  const manifestResponse = await context.request.get(manifestURL.href);
  assert.equal(manifestResponse.status(), 200);
  assert.equal(digest(await manifestResponse.body()), byPath.get('manifest.webmanifest').sha256);
  const manifest = await manifestResponse.json();
  assert.equal(new URL(manifest.start_url, manifestURL).pathname, mount);
  assert.equal(new URL(manifest.scope, manifestURL).pathname, mount);
  proof.manifest = { start_url: manifest.start_url, scope: manifest.scope };
  const cacheResponse = await context.request.get(new URL(meta.resourceManifest, baseURL).href);
  assert.equal(cacheResponse.status(), 200);
  assert.equal(digest(await cacheResponse.body()), byPath.get(meta.resourceManifest).sha256);
  proof.resourceManifest = meta.resourceManifest;

  await page.getByRole('button', { name: 'Créer mon premier profil', exact: false }).click();
  await page.getByRole('textbox', { name: 'Pseudonyme', exact: true }).fill(nickname);
  await page.getByRole('button', { name: 'Créer mon profil', exact: false }).click();
  await expect(page.getByRole('heading', { name: `Bonjour ${nickname}.`, exact: true })).toBeVisible();
  const profiles = await store('profiles');
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].nickname, nickname);
  await navigate('Explorer');
  await page.getByRole('textbox', { name: 'Rechercher une activité', exact: true }).fill('Mission en étapes');
  const card = page.locator('article.activity-card').filter({ has: page.getByRole('heading', { name: 'Mission en étapes', exact: true }) });
  await card.getByRole('button', { name: 'Découvrir l’activité', exact: false }).click();
  await page.getByRole('button', { name: 'Voir un exemple', exact: false }).click();
  await page.getByRole('button', { name: 'Commencer l’activité', exact: false }).click();
  await expect(page.locator('.game-fieldset')).toBeVisible();
  const runs = await store('runs');
  assert.equal(runs.length, 1);
  for (const [index, label] of ['Je prépare le matériel', 'Je réalise la tâche', 'Je range le matériel'].entries()) {
    let position = (await page.locator('.order-list li > span:nth-child(2)').allTextContents()).indexOf(label);
    assert.ok(position >= index);
    while (position > index) { await page.getByRole('button', { name: `Monter ${label}`, exact: true }).click(); position--; }
  }
  await page.getByRole('button', { name: 'Vérifier mon ordre', exact: true }).click();
  await expect(page.getByText('Les étapes respectent les dépendances.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Terminer la mission', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Comprendre vos réponses', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '✓ Enregistré sur cet appareil' })).toBeVisible();
  const attempts = await store('attempts');
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].id, runs[0].id);
  assert.equal(attempts[0].profileId, profiles[0].id);
  assert.equal(attempts[0].seed, runs[0].seed);
  assert.equal(attempts[0].gameVersion, runs[0].gameVersion);
  assert.equal(attempts[0].status, 'complete');
  assert.equal(attempts[0].outcome.correct, 3);
  assert.equal(attempts[0].outcome.errors, 0);
  await page.getByRole('button', { name: 'Terminer pour aujourd’hui', exact: true }).click();
  await page.reload();
  await navigate('Mes progrès');
  await expect(page.locator('.history-item')).toHaveCount(1);
  assert.deepEqual(await store('attempts'), attempts);
  await navigate('Réglages & données');
  const downloadWait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporter une sauvegarde', exact: false }).click();
  const downloaded = await downloadWait;
  const backupPath = await downloaded.path();
  assert.ok(backupPath);
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  assert.deepEqual(backup.profiles, profiles);
  assert.deepEqual(backup.attempts, attempts);
  proof.exportVerified = true;
  await expect(page.getByRole('region', { name: 'Disponibilité hors connexion', exact: true }).getByRole('status'))
    .toContainText('Les fichiers attendus de cette version sont présents dans le cache.', { timeout: 60000 });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const registrations = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(entry => ({ scope: entry.scope, script: entry.active?.scriptURL })));
  const applicationRegistrations = registrations.filter(entry => entry.scope === baseURL);
  assert.equal(applicationRegistrations.length, 1);
  assert.equal(applicationRegistrations[0].script, new URL('sw.js', baseURL).href);
  proof.registrations = applicationRegistrations;
  await context.setOffline(true);
  await page.reload();
  assert.equal(page.url(), baseURL);
  await expect(page.getByRole('status').filter({ hasText: 'Vous êtes hors connexion.' })).toBeVisible();
  await navigate('Mes progrès');
  await expect(page.locator('.history-item')).toHaveCount(1);
  assert.deepEqual(await store('profiles'), profiles);
  assert.deepEqual(await store('attempts'), attempts);
  assert.equal(await page.evaluate(() => navigator.onLine), false);
  assert.deepEqual(errors, []);
  Object.assign(proof, { passed: true, persistedProfiles: profiles.length, persistedAttempts: attempts.length,
    activity: '01', correctionVerified: true, resultVerified: true, offlineReloadVerified: true, pageErrors: errors });
} catch (error) {
  proof.error = String(error?.message ?? error).slice(0, 3000);
  proof.pageErrors = errors;
} finally {
  if (page) await page.screenshot({ path: resolve(outputDir, 'public-browser.png'), fullPage: false }).catch(() => {});
  await browser?.close();
  proof.completedAt = new Date().toISOString();
  await writeFile(resolve(outputDir, 'browser-status.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ passed: proof.passed, checkedURL: proof.checkedURL, deployedToPublicURL: proof.deployedToPublicURL,
    output: resolve(outputDir, 'browser-status.json'), error: proof.error ?? null }));
  if (!proof.passed) process.exitCode = 1;
}
