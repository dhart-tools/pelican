import * as path from 'path';

import { IFileEntry } from '@/types/registry';

const MAX_PAYLOAD_CHARS = 2000;

/**
 * Splits camelCase / kebab-case / snake_case into space-separated lowercase tokens.
 * `SignInForm` → `sign in form`. Helps LLM read component names as words.
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
 * Natural-language description of a source file for LLM reranking.
 *
 * Prose format — not structured key-value or repeated tokens. A local LLM
 * understands natural language descriptions better than TF-boosted keyword dumps.
 * TOKEN_BOOST (tri-repeating terms) was designed for bi-encoder embedding
 * similarity, not for LLM reasoning — it's counter-productive here.
 */
export function buildSourcePayload(entry: IFileEntry): string {
  const parts: string[] = [];

  const basename = basenameTokens(entry.path);
  parts.push(basename ? `Source component: ${basename} (${entry.path})` : `Source file: ${entry.path}`);

  if (entry.exports.length) {
    parts.push(`Exports: ${entry.exports.slice(0, 20).join(', ')}`);
  }
  if (entry.functions.length) {
    parts.push(`Functions: ${entry.functions.slice(0, 20).join(', ')}`);
  }
  if (entry.classes.length) {
    parts.push(`Classes: ${entry.classes.slice(0, 10).join(', ')}`);
  }
  if (entry.selectors?.length) {
    const sels = entry.selectors.map((s) => s.value).filter(Boolean).slice(0, 20).join(', ');
    if (sels) parts.push(`Data-test selectors: ${sels}`);
  }
  if (entry.routesDefined?.length) {
    const routes = entry.routesDefined.map((r) => r.path).filter(Boolean).slice(0, 15).join(', ');
    if (routes) parts.push(`Defines routes: ${routes}`);
  }
  if (entry.translationKeys?.length) {
    parts.push(`Translation keys: ${entry.translationKeys.slice(0, 15).join(', ')}`);
  }
  if (entry.jsxTextContent?.length) {
    parts.push(`UI text: ${entry.jsxTextContent.slice(0, 10).join(' | ')}`);
  }
  if (entry.imports.length) {
    parts.push(`Imports: ${entry.imports.slice(0, 15).join(', ')}`);
  }

  const out = parts.join('\n');
  return out.length > MAX_PAYLOAD_CHARS ? out.slice(0, MAX_PAYLOAD_CHARS) : out;
}

/**
 * Natural-language description of a test file for LLM reranking.
 * Detects Cypress vs unit/integration tests and formats accordingly.
 */
export function buildTestPayload(entry: IFileEntry): string {
  const parts: string[] = [];

  const basename = basenameTokens(entry.path);
  const isCypress = entry.cypress && (
    entry.cypress.describeBlocks.length > 0 ||
    entry.cypress.itBlocks.length > 0 ||
    entry.cypress.visitedRoutes.length > 0
  );

  if (isCypress) {
    parts.push(basename ? `Cypress test: ${basename} (${entry.path})` : `Test file: ${entry.path}`);
    const cy = entry.cypress!;
    if (cy.describeBlocks.length) {
      parts.push(`Describes: ${cy.describeBlocks.join(' > ')}`);
    }
    if (cy.itBlocks.length) {
      parts.push(`Tests: ${cy.itBlocks.slice(0, 15).join(' | ')}`);
    }
    if (cy.visitedRoutes.length) {
      parts.push(`Visits routes: ${cy.visitedRoutes.join(', ')}`);
    }
    if (cy.selectors.length) {
      const sels = cy.selectors
        .map((s) => (typeof s === 'string' ? s : (s.value ?? '')))
        .filter(Boolean)
        .slice(0, 20)
        .join(', ');
      if (sels) parts.push(`Uses selectors: ${sels}`);
    }
    if (cy.interceptedAPIs.length) {
      const apis = cy.interceptedAPIs
        .map((a) => `${a.method} ${a.urlPattern}`)
        .slice(0, 15)
        .join(', ');
      if (apis) parts.push(`Intercepts APIs: ${apis}`);
    }
    if (cy.containsText.length) {
      parts.push(`Asserts text: ${cy.containsText.slice(0, 10).join(' | ')}`);
    }
  } else {
    parts.push(basename ? `Test: ${basename} (${entry.path})` : `Test file: ${entry.path}`);
  }

  if (entry.imports.length) {
    parts.push(`Imports: ${entry.imports.slice(0, 15).join(', ')}`);
  }

  const out = parts.join('\n');
  return out.length > MAX_PAYLOAD_CHARS ? out.slice(0, MAX_PAYLOAD_CHARS) : out;
}

/**
 * One natural-language payload per `it` block for per-it max-pool scoring.
 * Used when the LLM needs to reason about individual test cases.
 */
export function buildItBlockPayloads(entry: IFileEntry): string[] {
  if (!entry.cypress?.itBlocks?.length) return [];

  const basename = basenameTokens(entry.path);
  const describes = entry.cypress.describeBlocks?.join(' > ') ?? '';

  return entry.cypress.itBlocks.map((it) => {
    const lines: string[] = [];
    if (basename) lines.push(`Test: ${basename} (${entry.path})`);
    if (describes) lines.push(`Describes: ${describes}`);
    lines.push(`It: ${it}`);
    return lines.join('\n');
  });
}
