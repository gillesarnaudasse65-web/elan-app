import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, access, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Ne jamais exécuter ce script dans le checkout de travail de l’utilisateur.
if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.RUNNER_TEMP) throw new Error('La persistance est réservée au runner éphémère GitHub Actions.');
const report = JSON.parse(await readFile('browser-status.json', 'utf8'));
if (report.format !== 'elan-public-browser-recipe' || report.sourceCommit !== process.env.GITHUB_SHA || report.repository !== process.env.GITHUB_REPOSITORY) throw new Error('Attestation étrangère au workflow courant.');
const branch = 'elan-browser-status';
const ref = `refs/heads/${branch}`;
function git(args, cwd) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
const exists = spawnSync('git', ['ls-remote', '--exit-code', '--heads', 'origin', ref], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
if (![0, 2].includes(exists.status)) throw new Error('Impossible de lire la branche de statut distante ; refus de la traiter comme absente.');
const directory = join(await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(), 'elan-status-')), 'checkout');
if (exists.status === 0) {
  git(['fetch', '--no-tags', 'origin', `${ref}:refs/remotes/origin/${branch}`]);
  git(['worktree', 'add', '--detach', directory, `refs/remotes/origin/${branch}`]);
} else {
  git(['worktree', 'add', '--detach', directory, 'HEAD']);
  git(['switch', '--orphan', branch], directory);
}
git(['config', 'user.name', 'github-actions[bot]'], directory);
git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], directory);
await writeFile(join(directory, 'browser-status.json'), JSON.stringify(report, null, 2) + '\n');
git(['add', '--', 'browser-status.json'], directory);
try {
  await access('public-browser.png');
  await copyFile('public-browser.png', join(directory, 'public-browser.png'));
  git(['add', '--', 'public-browser.png'], directory);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
git(['commit', '-m', `Attest publication ${report.sourceCommit.slice(0, 12)}: ${report.passed ? 'verified' : 'blocked'}`], directory);
// Pas de force-push : un conflit ou un refus de permission doit rester visible.
git(['push', 'origin', `HEAD:${ref}`], directory);
process.stdout.write(`Attestation ${report.passed ? 'vérifiée' : 'bloquée'} enregistrée sur ${branch}, sans modification de main.\n`);
