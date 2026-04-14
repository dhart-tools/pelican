import { IFileEntry } from '@/types/registry';

const MAX_PAYLOAD_CHARS = 2000;

/**
 * Builds a compact text summary of a test file's semantic surface for reranking.
 *
 * We deliberately avoid dumping raw source — the registry already extracted the
 * signals that matter (describe/it text, selectors, intercepts, routes, imports).
 * Concatenating these gives the embedding model a dense, noise-free view of what
 * the test actually covers.
 */
export function buildTestPayload(entry: IFileEntry): string {
  const parts: string[] = [];

  parts.push(`path: ${entry.path}`);

  if (entry.cypress) {
    const cy = entry.cypress;
    if (cy.describeBlocks.length) {
      parts.push(`describe: ${cy.describeBlocks.join(' | ')}`);
    }
    if (cy.itBlocks.length) {
      parts.push(`it: ${cy.itBlocks.join(' | ')}`);
    }
    if (cy.visitedRoutes.length) {
      parts.push(`routes: ${cy.visitedRoutes.join(' ')}`);
    }
    if (cy.selectors.length) {
      const sels = cy.selectors
        .map((s) => (typeof s === 'string' ? s : (s.value ?? '')))
        .filter(Boolean)
        .slice(0, 20);
      if (sels.length) parts.push(`selectors: ${sels.join(' ')}`);
    }
    if (cy.interceptedAPIs.length) {
      const apis = cy.interceptedAPIs
        .map((a) => `${a.method} ${a.urlPattern}`)
        .slice(0, 20);
      if (apis.length) parts.push(`intercepts: ${apis.join(' | ')}`);
    }
    if (cy.containsText.length) {
      parts.push(`text: ${cy.containsText.slice(0, 10).join(' | ')}`);
    }
    if (cy.urlAssertions.length) {
      const urls = cy.urlAssertions
        .map((u) => `${u.operator} ${u.expectedValue}`)
        .slice(0, 10);
      if (urls.length) parts.push(`urls: ${urls.join(' | ')}`);
    }
  }

  if (entry.imports.length) {
    parts.push(`imports: ${entry.imports.slice(0, 30).join(' ')}`);
  }

  const out = parts.join('\n');
  return out.length > MAX_PAYLOAD_CHARS ? out.slice(0, MAX_PAYLOAD_CHARS) : out;
}
