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
const nickname = 'Recette Élan jeux interactifs';
const APK_PATH = 'downloads/elan-android-v0.2.2.apk';
const ANDROID_METADATA_PATH = 'android-release.json';
// These values are frozen in the workflow only after the final package exists.
// A pending value must fail before a browser or public download is opened.
const expectedWebFiles = Number(process.env.ELAN_EXPECTED_WEB_FILE_COUNT);
const expectedFiles = Number(process.env.ELAN_EXPECTED_FILE_COUNT);
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
async function checkDashboard(activityCount, domains) {
  const widgets = page.getByRole('region', { name: 'Votre pratique en un regard', exact: true });
  await expect(widgets).toBeVisible();
  await expect(widgets.locator('.practice-day')).toHaveCount(7);
  await expect(widgets.locator('.week-widget')).toContainText(`${activityCount} ${activityCount === 1 ? 'activité' : 'activités'} cette semaine.`);
  await expect(widgets.getByRole('heading', { name: `${domains} ${domains === 1 ? 'domaine exploré' : 'domaines explorés'}`, exact: true })).toBeVisible();
}
const expectedBuild = process.env.ELAN_EXPECTED_BUILD_SHA256;
const proof = {
  format: 'elan-public-browser-recipe', version: 4, scenario: 'live-gameplay-android-0.2.2-and-difficulty-levels-1-to-3',
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

async function verifyDemonstration(before) {
  const demonstration = page.getByTestId('game-demonstration');
  await expect(demonstration).toBeVisible();
  await expect(demonstration).toHaveAttribute('data-game-id', '01');
  await expect(demonstration).toHaveAttribute('data-scene-kind', 'cards');
  await expect(demonstration).toHaveAttribute('data-reduced-motion', 'false');
  await expect(demonstration).toHaveAttribute('data-playing', 'true');
  const initialFrame = Number(await demonstration.getAttribute('data-frame-index'));
  assert.ok(Number.isInteger(initialFrame) && initialFrame >= 0);
  const initialCaption = await demonstration.getByTestId('demo-caption').innerText();
  await expect.poll(async () => Number(await demonstration.getAttribute('data-frame-index')))
    .toBeGreaterThan(initialFrame);
  await demonstration.getByRole('button', { name: 'Mettre la démonstration en pause', exact: true }).click();
  await expect(demonstration).toHaveAttribute('data-playing', 'false');
  const pausedFrame = Number(await demonstration.getAttribute('data-frame-index'));
  const pausedCaption = await demonstration.getByTestId('demo-caption').innerText();
  assert.notEqual(pausedCaption, initialCaption);
  // Wait longer than the authored 3.4 s frame so a stale timer would visibly
  // advance. The local deterministic suite separately covers larger jumps.
  await page.waitForTimeout(4000);
  await expect(demonstration).toHaveAttribute('data-frame-index', String(pausedFrame));
  await expect(demonstration.getByTestId('demo-caption')).toHaveText(pausedCaption);
  await demonstration.getByRole('button', { name: 'Étape suivante', exact: true }).click();
  await expect(demonstration).toHaveAttribute('data-frame-index', String(pausedFrame + 1));
  await expect(demonstration).toHaveAttribute('data-playing', 'false');
  await expect(demonstration.getByTestId('demo-gesture')).toBeVisible();
  const nextCaption = await demonstration.getByTestId('demo-caption').innerText();
  assert.notEqual(nextCaption, pausedCaption);
  assert.deepEqual(await store('profiles'), before.profiles);
  assert.deepEqual(await store('runs'), before.runs);
  assert.deepEqual(await store('attempts'), before.attempts);
  const record = { gameId: '01', sceneKind: 'cards', initialFrame, pausedFrame,
    steppedFrame: pausedFrame + 1, actualAutomaticProgressionVerified: true,
    pauseDurationMs: 4000, pauseVerified: true, manualStepVerified: true,
    gestureVisible: true, profilesUnchanged: true, runsUnchanged: true, attemptsUnchanged: true };
  proof.demonstrations = [...(proof.demonstrations ?? []), record];
  proof.animatedDemonstrationVerified = true;
  proof.demoPauseVerified = true;
  proof.demoDidNotCreateAttempts = true;
}

async function startPairs(expectedLevel) {
  await navigate('Explorer');
  await page.getByRole('textbox', { name: 'Rechercher une activité', exact: true }).fill('Cartes jumelles');
  const card = page.locator('article.activity-card').filter({ has: page.getByRole('heading', { name: 'Cartes jumelles', exact: true }) });
  await card.getByRole('button', { name: 'Découvrir l’activité', exact: false }).click();
  const journey = page.getByRole('list', { name: 'Étapes de l’activité', exact: true });
  await expect(journey.locator('[aria-current="step"]')).toContainText('Consigne');
  const beforeDemo = { profiles: await store('profiles'), runs: await store('runs'), attempts: await store('attempts') };
  await page.getByRole('button', { name: 'Voir un exemple', exact: false }).click();
  await expect(journey.locator('[aria-current="step"]')).toContainText('Exemple');
  await verifyDemonstration(beforeDemo);
  await page.getByRole('button', { name: 'Commencer l’activité', exact: false }).click();
  await expect(journey.locator('[aria-current="step"]')).toContainText('Jeu');
  await expect(page.locator('.memory-card').first()).toBeVisible();
  const surface = page.locator('.play-surface');
  await expect(surface).toBeVisible();
  await expect(surface.locator('[data-artwork-game="01"]')).toBeVisible();
  const cardButtons = surface.locator('.memory-card');
  const coveredNames = await cardButtons.evaluateAll(cards => cards.map(card => ({
    name: card.getAttribute('aria-label'), state: card.getAttribute('data-card-state'),
    frontHidden: card.querySelector('.pair-card-front')?.getAttribute('aria-hidden'),
    backHidden: card.querySelector('.pair-card-back')?.getAttribute('aria-hidden'),
  })));
  assert.ok(coveredNames.length > 0);
  for (const card of coveredNames) {
    assert.match(card.name ?? '', /^Retourner la carte \d+$/);
    assert.equal(card.state, 'covered');
    assert.equal(card.frontHidden, 'true');
    assert.equal(card.backHidden, 'true');
  }
  proof.coveredCardsAccessible = true;
  proof.gameArtworkVerified = true;
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
  const progress = page.locator('.pair-progress-track');
  await expect(progress).toHaveAttribute('role', 'progressbar');
  await expect(progress).toHaveAttribute('aria-valuenow', '0');
  await expect(progress).toHaveAttribute('aria-valuemax', String(cardCount / 2));
  await expect(progress.locator('.pair-progress-segment.is-complete')).toHaveCount(0);
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
  // Looking at the help must reveal the faces without awarding any pair.
  await expect(progress).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('button', { name: 'Masquer les cartes', exact: true }).click();
  const firstCard = page.locator('.memory-card').first();
  await expect(firstCard).toHaveAttribute('data-card-state', 'covered');
  await expect.poll(async () => firstCard.locator('.pair-card-flipper').evaluate(element => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return Math.abs(matrix.m11 - 1) < .001 && Math.abs(matrix.m33 - 1) < .001;
  })).toBe(true);
  const closedFlip = await firstCard.locator('.pair-card-flipper').evaluate(element => ({
    transform: getComputedStyle(element).transform,
    transition: getComputedStyle(element).transitionDuration,
    transformStyle: getComputedStyle(element).transformStyle,
  }));
  assert.equal(closedFlip.transformStyle, 'preserve-3d');
  assert.ok(closedFlip.transition.split(',').some(value => Number.parseFloat(value) > 0));
  let completedPairs = 0;
  let liveFlip;
  for (const indices of groups.values()) {
    await page.locator('.memory-card').nth(indices[0]).click();
    if (completedPairs === 0) {
      await expect(firstCard).toHaveAttribute('data-card-state', 'revealed');
      await expect(progress).toHaveAttribute('aria-valuenow', '0');
      await expect(progress.locator('.pair-progress-segment.is-complete')).toHaveCount(0);
      await expect.poll(async () => firstCard.locator('.pair-card-flipper').evaluate(element => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
        return Math.abs(matrix.m11 + 1) < .001 && Math.abs(matrix.m33 + 1) < .001;
      })).toBe(true);
      liveFlip = await firstCard.locator('.pair-card-flipper').evaluate(element => ({
        transform: getComputedStyle(element).transform,
        transition: getComputedStyle(element).transitionDuration,
      }));
      assert.notEqual(liveFlip.transform, closedFlip.transform);
    }
    await page.locator('.memory-card').nth(indices[1]).click();
    completedPairs++;
    await expect(progress).toHaveAttribute('aria-valuenow', String(completedPairs));
    await expect(progress.locator('.pair-progress-segment.is-complete')).toHaveCount(completedPairs);
    for (const index of indices) await expect(page.locator('.memory-card').nth(index)).toHaveAttribute('data-card-state', 'matched');
  }
  assert.equal(completedPairs, cardCount / 2);
  assert.ok(liveFlip);
  proof.liveGameplay = [...(proof.liveGameplay ?? []), {
    gameId: '01', runLevel: run.level, cardCount, surfaceVisible: true,
    closedTransform: closedFlip.transform, revealedTransform: liveFlip.transform,
    transitionDuration: liveFlip.transition, preserve3dVerified: true,
    coveredCardsAccessible: true, partialRevealAwardedNoPair: true,
    helpAwardedNoPair: true, progressMatchesActualPairs: completedPairs,
  }];
  proof.liveGameplayVerified = true;
  proof.cardFlipVerified = true;
  proof.pairProgressVerified = true;
  await page.getByRole('button', { name: 'Voir mon résultat', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Comprendre vos réponses', exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Étapes de l’activité', exact: true }).locator('[aria-current="step"]')).toContainText('Bilan');
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
  assert.equal(meta.format, 'elan-publication');
  assert.equal(meta.version, 2);
  assert.ok(Number.isInteger(expectedWebFiles) && expectedWebFiles >= 8 && expectedWebFiles <= 128);
  assert.equal(expectedFiles, expectedWebFiles + 2);
  assert.equal(meta.fileCount, expectedFiles);
  assert.equal(meta.webFileCount, expectedWebFiles);
  assert.equal(meta.files.length, meta.fileCount);
  assert.equal(new Set(meta.files.map(file => file.path)).size, meta.fileCount);
  for (const file of meta.files) {
    assert.match(file.path, /^(?:assets\/[A-Za-z0-9_-]+\.(?:js|css|png|svg|webp|woff2)|(?:icon(?:-192|-512)?\.(?:svg|png))|index\.html|manifest\.webmanifest|sw\.js|workbox-[A-Za-z0-9_-]+\.js|pwa-resources-[A-Za-z0-9_-]+\.json|android-release\.json|downloads\/elan-android-v0\.2\.2\.apk)$/);
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= (file.path === APK_PATH ? 50000000 : 10000000));
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(digest(canonical({ basePath: meta.basePath, files: meta.files })), meta.buildSha256);
  assert.equal(meta.androidRelease?.version, '0.2.2');
  assert.equal(meta.androidRelease?.minAndroid, 7);
  assert.equal(meta.androidRelease?.url, APK_PATH);
  assert.match(expectedBuild ?? '', /^[a-f0-9]{64}$/);
  assert.equal(meta.buildSha256, expectedBuild);
  proof.expectedBuildSha256 = expectedBuild;
  proof.buildSha256 = meta.buildSha256;
  const byPath = new Map(meta.files.map(file => [file.path, file]));
  const apkFile = byPath.get(APK_PATH);
  assert.ok(apkFile);
  assert.equal(meta.androidRelease.bytes, apkFile.bytes);
  assert.equal(meta.androidRelease.sha256, apkFile.sha256);
  assert.ok(byPath.has(ANDROID_METADATA_PATH));
  proof.publicationVersion = meta.version; proof.fileCount = meta.fileCount; proof.webFileCount = meta.webFileCount;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  proof.browserVersion = browser.version();
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 }, locale: 'fr-FR', reducedMotion: 'no-preference',
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
  proof.appIconDimensions = [];
  for (const size of [192, 512]) {
    const path = `icon-${size}.png`;
    const icon = manifest.icons.find(item => item.src === mount + path && item.sizes === `${size}x${size}`);
    assert.ok(icon);
    const response = await context.request.get(new URL(path, baseURL).href);
    assert.equal(response.status(), 200);
    const bytes = await response.body();
    assert.equal(bytes.length, byPath.get(path).bytes); assert.equal(digest(bytes), byPath.get(path).sha256);
    assert.equal(bytes.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), size); assert.equal(bytes.readUInt32BE(20), size);
    proof.appIconDimensions.push(size);
  }
  const cacheResponse = await context.request.get(new URL(meta.resourceManifest, baseURL).href);
  assert.equal(cacheResponse.status(), 200);
  assert.equal(digest(await cacheResponse.body()), byPath.get(meta.resourceManifest).sha256);
  proof.resourceManifest = meta.resourceManifest;
  const cache = await cacheResponse.json();
  assert.ok(Array.isArray(cache.resources));
  assert.ok(cache.resources.every(resource => ![mount + APK_PATH, mount + ANDROID_METADATA_PATH].includes(resource.url)));
  proof.apkExcludedFromPwaResources = true;

  const androidMetadata = await context.request.get(new URL(ANDROID_METADATA_PATH, baseURL).href);
  assert.equal(androidMetadata.status(), 200);
  const androidBytes = await androidMetadata.body();
  assert.equal(androidBytes.length, byPath.get(ANDROID_METADATA_PATH).bytes);
  assert.equal(digest(androidBytes), byPath.get(ANDROID_METADATA_PATH).sha256);
  assert.deepEqual(JSON.parse(androidBytes.toString('utf8')), meta.androidRelease);
  const androidLink = page.getByRole('link', { name: 'Télécharger l’APK Android', exact: true });
  await expect(androidLink).toBeVisible();
  const apkURL = new URL(await androidLink.getAttribute('href'), baseURL);
  assert.equal(apkURL.href, new URL(APK_PATH, baseURL).href);
  const apkResponse = await context.request.get(apkURL.href);
  assert.equal(apkResponse.status(), 200);
  const receivedApk = await apkResponse.body();
  assert.equal(receivedApk.length, apkFile.bytes); assert.equal(digest(receivedApk), apkFile.sha256);
  assert.equal(receivedApk.subarray(0,4).toString('hex'), '504b0304');
  const androidDownloadWait = page.waitForEvent('download');
  await androidLink.click();
  const androidDownload = await androidDownloadWait;
  assert.equal(await androidDownload.failure(), null);
  assert.equal(androidDownload.suggestedFilename(), 'elan-android-v0.2.2.apk');
  const androidDownloadPath = await androidDownload.path(); assert.ok(androidDownloadPath);
  const downloadedApk = await readFile(androidDownloadPath);
  assert.equal(downloadedApk.length, apkFile.bytes); assert.equal(digest(downloadedApk), apkFile.sha256);
  assert.equal(page.url(), baseURL);
  proof.androidDownload = { verified: true, metadataVerified: true, browserDownloadVerified: true, url: apkURL.href, status: apkResponse.status(), bytes: downloadedApk.length, sha256: digest(downloadedApk), version: meta.androidRelease.version, minAndroid: meta.androidRelease.minAndroid, physicalInstallationTested: false };
  proof.androidDownloadVerified = true;

  await page.getByRole('button', { name: 'Créer mon premier profil', exact: false }).click();
  await page.getByRole('textbox', { name: 'Pseudonyme', exact: true }).fill(nickname);
  await page.getByRole('button', { name: 'Créer mon profil', exact: false }).click();
  await expect(page.getByRole('heading', { name: `Bonjour ${nickname}.`, exact: true })).toBeVisible();
  await expect(page.locator('.daily-hero .brand-scene')).toBeVisible();
  await checkDashboard(0, 0);
  await page.getByRole('button', { name: 'Choisir une activité', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Domaines', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Domaines', exact: true }).getByRole('button')).toHaveCount(9);
  const originalProfiles = await store('profiles');
  assert.equal(originalProfiles.length, 1);
  assert.equal(originalProfiles[0].nickname, nickname);
  assert.equal(originalProfiles[0].difficulty, 1);
  const first = await startPairs(1);
  assert.equal(first.run.profileId, originalProfiles[0].id);
  const firstAttempt = await finishPairs(first.run, first.cardCount, originalProfiles[0].id);
  await checkDashboard(1, 1);
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
  await checkDashboard(2, 1);
  proof.modernInterfaceVerified = true; proof.dashboardWidgetsVerified = true; proof.activityJourneyVerified = true;
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
  await navigate('Aujourd’hui');
  await checkDashboard(2, 1);
  const cachedDownloadPaths = await page.evaluate(async () => {
    const paths = [];
    for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys()) { const path = new URL(request.url).pathname; if (path.endsWith('.apk') || path.endsWith('/android-release.json')) paths.push(path); }
    return paths;
  });
  assert.deepEqual(cachedDownloadPaths, []);
  proof.apkExcludedFromPwaCache = true;
  await page.evaluate(() => scrollTo(0, 0));
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
