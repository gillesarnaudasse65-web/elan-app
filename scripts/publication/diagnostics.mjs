const repository = 'gillesarnaudasse65-web/elan-app';
const origin = 'https://api.github.com';
const configureStep = 'Configurer Pages et tenter son activation autorisée';

function redact(value, token, maximum = 2000) {
  let text = typeof value === 'string' ? value : '';
  if (token) text = text.split(token).join('[redacted]');
  return text.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/\bgh[opsu]_[A-Za-z0-9_]+\b/g, '[redacted]').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

/** Journal borné du seul échec configure-pages du run courant ; aucun endpoint générique. */
export async function collectPagesConfigurationDiagnostic(input, { fetchImpl = fetch } = {}) {
  const unknown = reason => ({ status: 'unknown', scope: 'current-run/deploy/configure-pages', reason, annotations: [] });
  if (input.repository !== repository || !/^\d{1,20}$/.test(input.runId ?? '') || !/^[a-f0-9]{40}$/.test(input.sourceCommit ?? '') || typeof input.token !== 'string' || !input.token) return unknown('Contexte du workflow ou authentification de diagnostic indisponible.');
  async function get(path, phase) {
    const response = await fetchImpl(origin + path, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${input.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Elan-own-publication-diagnostic' },
    });
    if (response.status !== 200) throw new Error(`GitHub API HTTP ${response.status} (${phase}).`);
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) { bytes += chunk.byteLength; if (bytes > 2_000_000) throw new Error(`Réponse ${phase} trop volumineuse.`); chunks.push(Buffer.from(chunk)); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  try {
    const runJobs = await get(`/repos/${repository}/actions/runs/${input.runId}/jobs?filter=latest&per_page=100`, 'jobs');
    const job = runJobs.jobs?.find(candidate => candidate.name === 'deploy' && String(candidate.run_id) === input.runId && (!candidate.head_sha || candidate.head_sha === input.sourceCommit));
    if (!job || !job.steps?.some(step => step.name === configureStep && step.conclusion === 'failure')) return unknown('Aucun échec configure-pages du job deploy courant identifié.');
    const check = new URL(job.check_run_url);
    const prefix = `/repos/${repository}/check-runs/`;
    if (check.origin !== origin || check.username || check.password || check.search || check.hash || !check.pathname.startsWith(prefix) || !/^\d+$/.test(check.pathname.slice(prefix.length))) return unknown('Référence de check-run hors du dépôt ou du périmètre autorisé.');
    const annotations = await get(`${check.pathname}/annotations?per_page=100`, 'annotations');
    if (!Array.isArray(annotations)) return unknown('Réponse annotations inconnue.');
    const selected = annotations.filter(annotation => annotation.annotation_level === 'failure').slice(0, 10).map(annotation => ({
      level: 'failure', title: redact(annotation.title, input.token, 200), message: redact(annotation.message, input.token),
      path: redact(annotation.path, input.token, 200), startLine: Number.isSafeInteger(annotation.start_line) ? annotation.start_line : null,
    }));
    return selected.length ? { status: 'collected', scope: 'current-run/deploy/configure-pages', jobId: job.id, checkRunId: check.pathname.slice(prefix.length), annotations: selected }
      : unknown('Le check-run courant ne fournit aucune annotation d’erreur ; cause précise encore inconnue.');
  } catch (error) { return unknown(redact(error.message, input.token)); }
}
