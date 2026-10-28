import { readFile, writeFile } from 'node:fs/promises';
import { verifyDeployment } from './healthcheck.mjs';
import { validateMetadata } from './model.mjs';
import { collectPagesConfigurationDiagnostic } from './diagnostics.mjs';

export async function createAttestation(meta, input, verify = verifyDeployment) {
  validateMetadata(meta);
  const outcome = value => ['success', 'failure', 'cancelled', 'skipped'].includes(value) ? value : 'not-run';
  const report = {
    format: 'elan-publication-attestation', version: 1, createdAt: new Date().toISOString(),
    sourceCommit: /^[a-f0-9]{40}$/.test(input.sourceCommit ?? '') ? input.sourceCommit : null,
    sourceCommitMeaning: 'Commit exact de la branche de publication exécuté par GitHub Actions ; les sources applicatives locales sont identifiées séparément par sourceTreeSha256.',
    repository: meta.repository, sourceRepository: meta.sourceRepository, repositoryBaseCommit: meta.repositoryBaseCommit,
    repositoryBaseCommitMeaning: 'Commit de départ du dépôt source privé gillesarnaudasse65-web/Elan ; il ne représente pas un commit de la cible publique gillesarnaudasse65-web/elan-app.',
    sourceWorkingTreeUncommitted: meta.sourceWorkingTreeUncommitted, sourceTreeSha256: meta.sourceTreeSha256,
    buildSha256: meta.buildSha256, fileCount: meta.fileCount, basePath: meta.basePath,
    configOutcome: outcome(input.configOutcome), deployOutcome: outcome(input.deployOutcome), deployJobOutcome: outcome(input.deployJobOutcome),
    verifiedURL: null, verificationPassed: false, checkedURL: null, resources: [], errors: [],
    workflowRunId: /^\d+$/.test(input.workflowRunId ?? '') ? input.workflowRunId : null,
  };
  if (!report.sourceCommit) report.errors.push('Le SHA du commit de publication exécuté est absent ou invalide.');
  if (report.configOutcome !== 'success') report.errors.push(`Configuration Pages : ${report.configOutcome}. La cause précise doit être établie par le diagnostic borné du workflow ; aucune permission ou offre du dépôt n’est présumée responsable.`);
  if (report.deployOutcome !== 'success' || report.deployJobOutcome !== 'success') report.errors.push(`Déploiement Pages : ${report.deployOutcome} ; job : ${report.deployJobOutcome}. Aucune URL vérifiée ne peut être annoncée.`);
  if (!report.errors.length) {
    try {
      const check = await verify(meta, input.pageUrl);
      report.checkedURL = check.checkedURL; report.resources = check.resources;
      report.verificationPassed = check.passed === true && check.resources.length === meta.files.length + 1 && check.resources.every(resource => resource.passed === true);
      if (report.verificationPassed) report.verifiedURL = check.verifiedURL;
      else report.errors.push('La page publique ou au moins une ressource ne correspond pas au build attendu ; aucune publication réussie attestée.');
    } catch (error) { report.errors.push(error.message); }
  }
  return report;
}

if (process.argv[1] && new URL(import.meta.url).pathname === new URL(process.argv[1], 'file://').pathname) {
  const meta = JSON.parse(await readFile('publication-meta.json', 'utf8'));
  const report = await createAttestation(meta, {
    sourceCommit: process.env.GITHUB_SHA, configOutcome: process.env.PAGES_CONFIG_OUTCOME,
    deployOutcome: process.env.PAGES_DEPLOY_OUTCOME, deployJobOutcome: process.env.PAGES_DEPLOY_JOB_OUTCOME,
    pageUrl: process.env.PAGES_PAGE_URL, workflowRunId: process.env.GITHUB_RUN_ID,
  });
  if (report.configOutcome === 'failure') {
    report.configurationDiagnostic = process.env.GITHUB_ACTIONS === 'true'
      ? await collectPagesConfigurationDiagnostic({ repository: process.env.GITHUB_REPOSITORY, runId: process.env.GITHUB_RUN_ID, sourceCommit: process.env.GITHUB_SHA, token: process.env.GITHUB_TOKEN })
      : { status: 'unknown', scope: 'current-run/deploy/configure-pages', reason: 'Diagnostic réservé au runner du workflow courant.', annotations: [] };
  }
  await writeFile('publication-status.json', JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(report.verificationPassed ? `Vérification HTTPS réussie : ${report.verifiedURL}\n` : `Publication non attestée : ${report.errors.join(' ')}\n`);
  // Le job persiste d’abord le résultat exact, puis échoue explicitement si nécessaire.
}
