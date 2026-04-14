import * as path from 'path';

import { IFileEntry } from '@/types/registry';

const MAX_PAYLOAD_CHARS = 2000;

/**
 * TF-style boost: distinctive tokens (selectors, routes, intercepted URLs,
 * filenames) get repeated 3× in the payload. The embedding model treats
 * repeated terms as more salient — this is the cheapest way to make
 * "data-test=signin-username" outweigh generic JSX/MUI imports without
 * needing a code-tuned encoder.
 */
const TOKEN_BOOST = 3;

function repeat(s: string, n: number): string {
  return Array.from({ length: n }, () => s).join(' ');
}

/**
 * Splits camelCase / kebab-case / snake_case identifiers into space-separated
 * lowercase tokens. `SignInForm` → `sign in form`. Helps the embedder see the
 * filename/component as semantic words rather than one opaque blob.
 */
function tokenize(name: string): string {
  return name
    .replace(/[-_/.]/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function basenameTokens(filePath: string): string {
  const base = path.basename(filePath).replace(/\.(tsx?|jsx?|cy\.tsx?|spec\.tsx?)$/i, '');
  return tokenize(base);
}

/**
 * Builds a compact text summary of a SOURCE file's semantic surface.
 *
 * Symmetric with `buildTestPayload` — both sides emit the same shape of
 * distilled labels (exports, selectors, routes, imports). The earlier
 * full-file fallback was lexical noise: raw JSX + MUI imports drowned
 * the real signal.
 *
 * Distinctive tokens (filename, selectors, routes) are repeated 3× so the
 * embedder weights them above generic React/MUI boilerplate.
 */
export function buildSourcePayload(entry: IFileEntry): string {
  const parts: string[] = [];

  const baseTokens = basenameTokens(entry.path);
  if (baseTokens) {
    parts.push(`name: ${repeat(baseTokens, TOKEN_BOOST)}`);
  }
  parts.push(`path: ${entry.path}`);

  if (entry.exports.length) {
    const ex = entry.exports.slice(0, 30).map(tokenize).filter(Boolean).join(' ');
    if (ex) parts.push(`exports: ${repeat(ex, TOKEN_BOOST)}`);
  }
  if (entry.classes.length) {
    parts.push(`classes: ${entry.classes.slice(0, 20).map(tokenize).join(' ')}`);
  }
  if (entry.functions.length) {
    parts.push(`functions: ${entry.functions.slice(0, 30).map(tokenize).join(' ')}`);
  }
  if (entry.interfaces.length) {
    parts.push(`interfaces: ${entry.interfaces.slice(0, 20).map(tokenize).join(' ')}`);
  }

  if (entry.selectors?.length) {
    const sels = entry.selectors
      .map((s) => s.value)
      .filter(Boolean)
      .slice(0, 30)
      .join(' ');
    if (sels) parts.push(`selectors: ${repeat(sels, TOKEN_BOOST)}`);
  }

  if (entry.routesDefined?.length) {
    const routes = entry.routesDefined
      .map((r) => r.path)
      .filter(Boolean)
      .slice(0, 20)
      .join(' ');
    if (routes) parts.push(`routes: ${repeat(routes, TOKEN_BOOST)}`);
  }

  if (entry.translationKeys?.length) {
    parts.push(`i18n: ${entry.translationKeys.slice(0, 20).join(' ')}`);
  }

  if (entry.jsxTextContent?.length) {
    parts.push(`text: ${entry.jsxTextContent.slice(0, 15).join(' | ')}`);
  }

  if (entry.imports.length) {
    parts.push(`imports: ${entry.imports.slice(0, 20).join(' ')}`);
  }

  const out = parts.join('\n');
  return out.length > MAX_PAYLOAD_CHARS ? out.slice(0, MAX_PAYLOAD_CHARS) : out;
}

/**
 * Builds a compact text summary of a test file's semantic surface for reranking.
 *
 * We deliberately avoid dumping raw source — the registry already extracted the
 * signals that matter (describe/it text, selectors, intercepts, routes, imports).
 *
 * Distinctive tokens (filename, selectors, routes, intercepted URLs) get
 * repeated 3× to outweigh generic test-runner boilerplate.
 */
export function buildTestPayload(entry: IFileEntry): string {
  const parts: string[] = [];

  const baseTokens = basenameTokens(entry.path);
  if (baseTokens) {
    parts.push(`name: ${repeat(baseTokens, TOKEN_BOOST)}`);
  }
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
      parts.push(`routes: ${repeat(cy.visitedRoutes.join(' '), TOKEN_BOOST)}`);
    }
    if (cy.selectors.length) {
      const sels = cy.selectors
        .map((s) => (typeof s === 'string' ? s : (s.value ?? '')))
        .filter(Boolean)
        .slice(0, 20)
        .join(' ');
      if (sels) parts.push(`selectors: ${repeat(sels, TOKEN_BOOST)}`);
    }
    if (cy.interceptedAPIs.length) {
      const apis = cy.interceptedAPIs
        .map((a) => `${a.method} ${a.urlPattern}`)
        .slice(0, 20)
        .join(' | ');
      if (apis) parts.push(`intercepts: ${repeat(apis, TOKEN_BOOST)}`);
    }
    if (cy.containsText.length) {
      parts.push(`text: ${cy.containsText.slice(0, 10).join(' | ')}`);
    }
    if (cy.urlAssertions.length) {
      const urls = cy.urlAssertions
        .map((u) => `${u.operator} ${u.expectedValue}`)
        .slice(0, 10)
        .join(' | ');
      if (urls) parts.push(`urls: ${urls}`);
    }
  }

  if (entry.imports.length) {
    parts.push(`imports: ${entry.imports.slice(0, 20).join(' ')}`);
  }

  const out = parts.join('\n');
  return out.length > MAX_PAYLOAD_CHARS ? out.slice(0, MAX_PAYLOAD_CHARS) : out;
}

/**
 * Returns one payload per `it` block, each carrying the test's identifying
 * context (name, describe blocks, the it text). Used by the per-it max-pool
 * reranker pass — embedding each it separately and taking the max sim is
 * more discriminating than embedding the whole concatenated test payload.
 *
 * Returns empty array if the test has no it blocks (caller falls back to
 * full test payload).
 */
export function buildItBlockPayloads(entry: IFileEntry): string[] {
  if (!entry.cypress?.itBlocks?.length) return [];

  const baseTokens = basenameTokens(entry.path);
  const describes = entry.cypress.describeBlocks?.join(' | ') ?? '';

  return entry.cypress.itBlocks.map((it) => {
    const lines: string[] = [];
    if (baseTokens) lines.push(`name: ${baseTokens}`);
    if (describes) lines.push(`describe: ${describes}`);
    lines.push(`it: ${it}`);
    return lines.join('\n');
  });
}
