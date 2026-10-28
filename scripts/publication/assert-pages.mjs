import { readFile } from 'node:fs/promises';
import { configuredBaseMatches, verifyLocalArtifact } from './model.mjs';

const meta = JSON.parse(await readFile('publication-meta.json', 'utf8'));
if (process.env.GITHUB_REPOSITORY !== meta.repository) throw new Error('Ce paquet ne correspond pas au dépôt du workflow.');
configuredBaseMatches(process.env.PAGES_CONFIGURED_BASE_PATH, meta.basePath);
await verifyLocalArtifact('site', meta);
process.stdout.write(`Configuration Pages et build conformes : ${meta.basePath}, ${meta.fileCount} fichiers, SHA256 ${meta.buildSha256}.\n`);
