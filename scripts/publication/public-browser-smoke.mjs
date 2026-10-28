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
const nickname = 'Recette publique des niveaux';
const expectedBuild = process.env.ELAN_EXPECTED_BUILD_SHA256;
const proof = {
  format: 'elan-public-browser-recipe', version: 1, scenario: 'difficulty-levels-1-to-3',
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

async function startPairs(expectedLevel) {
  await navigate('Explorer');
  await page.getByRole('textbox', { name: 'Rechercher une activité', exact: true }).fill('Cartes jumelles');
  const card = page.locator('article.activity-card').filter({ has: page.getByRole('heading', { name: 'Cartes jumelles', exact: true }) });
  await card.getByRole('button', { name: 'Découvrir l’activité', exact: false }).click();
  await page.getByRole('button', { name: 'Voir un exemple', exact: false }).click();
  await page.getByRole('button', { name: 'Commencer l’activité', exact: false }).click();
  await expect(page.locator('.memory-card').first()).toBeVisible();
  const runs = await store('runs');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].gameId, '01');
  assert.equal(runs[0].level, expectedLevel);
  await expect(page.locator('.session-header .pill')).toContainText(`Niveau ${expectedLevel}`);
  const cardCount = await page.locator('.memory-card').count();
  assert.equal(cardCount, expectedLevel === 1 ? 6 : 10);
  return { run: runs[0], cardCount };
}

async function finishPairs(run, cardCount, profileId) {
  await page.getByRole('button', { name: 'Aide : observer toutes les cartes', exact: true }).click();
  const labels = await page.locator('.memory-card').evaluateAll(cards => cards.map(card => card.getAttribute('aria-label') ?? ''));
  assert.equal(labels.length, cardCount);
  const groups = new Map();
  labels.forEach((label, index) => {
    const symbol = label.split(' : ')[1];
    assert.ok(symbol);
    groups.set(symbol, [...(groups.get(symbol) ?? []), index]);
  });
  assert.equal(groups.size, cardCount / 2);
  for (const indices of groups.values()) assert.equal(indices.length, 2);
  await page.getByRole('button', { name: 'Masquer les cartes', exact: true }).click();
  for (const indices of groups.values()) for (const index of indices) await page.locator('.memory-card').nth(index).click();
  await page.getByRole('button', { name: 'Voir mon résultat', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Comprendre vos réponses', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '✓ Enregistré sur cet appareil' })).toBeVisible();
  const attempt = (await store('attempts')).find(entry => entry.id === run.id);
  assert.ok(attempt);
  assert.equal(attempt.profileId, profileId);
  assert.equal(attempt.gameId, run.gameId);
  assert.equal(attempt.gameId, '01');
  assert.equal(attempt.level, run.level);
  assert.equal(attempt.seed, run.seed);
  assert.equal(attempt.gameVersion, run.gameVersion);
  assert.equal(attempt.status, 'complete');
  assert.equal(attempt.outcome.items, cardCount / 2);
  assert.equal(attempt.outcome.correct, cardCount / 2);
  assert.equal(attempt.outcome.errors, 0);
  assert.equal(attempt.outcome.hints, 1);
  await page.getByRole('button', { name: 'Terminer pour aujourd’hui', exact: true }).click();
  return attempt;
}

try {
  const meta = JSON.parse(await readFile(resolve(packageRoot, 'publication-meta.json'), 'utf8'));
  assert.equal(meta.repository, 'gillesarnaudasse65-web/elan-app');
  assert.equal(proof.repository, meta.repository);
  if (!local) assert.match(proof.sourceCommit ?? '', /^[a-f0-9]{40}$/);
  assert.equal(meta.basePath, mount);
  assert.equal(meta.fileCount, 28);
  assert.match(expectedBuild ?? '', /^[a-f0-9]{64}$/);
  assert.equal(meta.buildSha256, expectedBuild);
  proof.expectedBuildSha256 = expectedBuild;
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
  const originalProfiles = await store('profiles');
  assert.equal(originalProfiles.length, 1);
  assert.equal(originalProfiles[0].nickname, nickname);
  assert.equal(originalProfiles[0].difficulty, 1);
  const first = await startPairs(1);
  assert.equal(first.run.profileId, originalProfiles[0].id);
  const firstAttempt = await finishPairs(first.run, first.cardCount, originalProfiles[0].id);
  const firstAttempts = await store('attempts');
  assert.deepEqual(firstAttempts, [firstAttempt]);
  await navigate('Explorer');
  const difficulty = page.getByRole('combobox', { name: 'Difficulté pour jouer', exact: true });
  await expect(difficulty).toBeEnabled();
  await expect(difficulty).toHaveValue('1');
  await difficulty.selectOption('3');
  await expect(page.getByRole('status').filter({ hasText: 'Difficulté enregistrée : niveau 3.' })).toBeVisible();
  await expect(difficulty).toHaveValue('3');
  await expect(difficulty).toBeEnabled();
  const profiles = [{ ...originalProfiles[0], difficulty: 3 }];
  assert.deepEqual(await store('profiles'), profiles);
  assert.deepEqual(await store('attempts'), firstAttempts);
  // The supported-level filter remains independent of the chosen playing level.
  await page.getByRole('combobox', { name: 'Palier pris en charge', exact: true }).selectOption('5');
  await expect(difficulty).toHaveValue('3');
  assert.deepEqual(await store('profiles'), profiles);
  assert.deepEqual(await store('attempts'), firstAttempts);
  const second = await startPairs(3);
  assert.equal(second.run.profileId, originalProfiles[0].id);
  assert.notEqual(second.run.id, first.run.id);
  assert.ok(second.cardCount > first.cardCount);
  const secondAttempt = await finishPairs(second.run, second.cardCount, originalProfiles[0].id);
  const attempts = await store('attempts');
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts.find(entry => entry.id === first.run.id), firstAttempt);
  assert.deepEqual(attempts.find(entry => entry.id === second.run.id), secondAttempt);
  assert.deepEqual(await store('runs'), []);
  await page.reload();
  assert.equal(page.url(), baseURL);
  await navigate('Explorer');
  await expect(page.getByRole('combobox', { name: 'Difficulté pour jouer', exact: true })).toHaveValue('3');
  assert.deepEqual(await store('profiles'), profiles);
  assert.deepEqual(await store('attempts'), attempts);
  await navigate('Mes progrès');
  await expect(page.locator('.history-item')).toHaveCount(2);
  proof.playedActivities = [
    { gameId: first.run.gameId, runLevel: first.run.level, attemptLevel: firstAttempt.level,
      cardCount: first.cardCount, pairs: firstAttempt.outcome.items, correct: firstAttempt.outcome.correct },
    { gameId: second.run.gameId, runLevel: second.run.level, attemptLevel: secondAttempt.level,
      cardCount: second.cardCount, pairs: secondAttempt.outcome.items, correct: secondAttempt.outcome.correct },
  ];
  Object.assign(proof, { difficultyChangeVerified: true, supportedLevelFilterIndependent: true,
    profileDifficultyAfterReload: profiles[0].difficulty, previousAttemptUnchanged: true,
    cardCountIncreased: second.cardCount > first.cardCount });
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
  await expect(page.locator('.history-item')).toHaveCount(2);
  assert.deepEqual(await store('profiles'), profiles);
  assert.deepEqual(await store('attempts'), attempts);
  assert.equal(await page.evaluate(() => navigator.onLine), false);
  assert.deepEqual(errors, []);
  Object.assign(proof, { passed: true, persistedProfiles: profiles.length, persistedAttempts: attempts.length,
    activity: first.run.gameId, gameIds: [...new Set([first.run.gameId, second.run.gameId])],
    levels: [firstAttempt.level, secondAttempt.level], finalProfileDifficulty: profiles[0].difficulty,
    correctionVerified: true, resultVerified: true, offlineReloadVerified: true, pageErrors: errors });
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
