import { IFileEntry } from '@/types/registry';

const MAX_PAYLOAD_CHARS = 2000;

/**
 * Builds a compact text summary of a SOURCE file's semantic surface.
 *
 * Symmetric with `buildTestPayload` — both sides should emit the same shape
 * of distilled labels (exports, selectors, routes, imports) so the embedding
 * model compares apples to apples. The earlier "full file content" fallback
 * was lexical noise: raw JSX + MUI imports drowned the real signal.
 */
export function buildSourcePayload(entry: IFileEntry): string {
  const parts: string[] = [];

  parts.push(`path: ${entry.path}`);

  if (entry.exports.length) {
    parts.push(`exports: ${entry.exports.slice(0, 30).join(' ')}`);
  }
  if (entry.classes.length) {
    parts.push(`classes: ${entry.classes.slice(0, 20).join(' ')}`);
  }
  if (entry.functions.length) {
    parts.push(`functions: ${entry.functions.slice(0, 30).join(' ')}`);
  }
  if (entry.interfaces.length) {
    parts.push(`interfaces: ${entry.interfaces.slice(0, 20).join(' ')}`);
  }

  if (entry.selectors?.length) {
    const sels = entry.selectors
      .map((s) => s.value)
      .filter(Boolean)
      .slice(0, 30);
    if (sels.length) parts.push(`selectors: ${sels.join(' ')}`);
  }

  if (entry.routesDefined?.length) {
    const routes = entry.routesDefined
      .map((r) => r.path)
      .filter(Boolean)
      .slice(0, 20);
    if (routes.length) parts.push(`routes: ${routes.join(' ')}`);
  }

  if (entry.translationKeys?.length) {
    parts.push(`i18n: ${entry.translationKeys.slice(0, 20).join(' ')}`);
  }

  if (entry.jsxTextContent?.length) {
    parts.push(`text: ${entry.jsxTextContent.slice(0, 15).join(' | ')}`);
  }

  if (entry.imports.length) {
    parts.push(`imports: ${entry.imports.slice(0, 30).join(' ')}`);
  }

  const out = parts.join('\n');
  return out.length > MAX_PAYLOAD_CHARS ? out.slice(0, MAX_PAYLOAD_CHARS) : out;
}

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
