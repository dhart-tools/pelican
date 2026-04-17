import * as path from 'path';

import { IFileEntry } from '@/types/registry';

const MAX_PAYLOAD_CHARS = 2000;

const PROVIDERS = ['okta', 'google', 'cognito', 'auth0', 'facebook'] as const;
type Provider = (typeof PROVIDERS)[number];

/**
 * Infer a provider tag from filename + imports. Helps the LLM reject
 * provider-mismatched test pairs (e.g. AppOkta.tsx against a Google spec).
 */
export function detectSourceProvider(entry: IFileEntry): Provider | undefined {
  const base = path.basename(entry.path).toLowerCase();
  for (const p of PROVIDERS) if (base.includes(p)) return p;
  const imports = entry.imports.map((i) => i.toLowerCase());
  for (const p of PROVIDERS) if (imports.some((i) => i.includes(p))) return p;
  return undefined;
}

/** `src/index*.tsx` and similar bundle entry points. */
export function isSourceEntryPoint(entry: IFileEntry): boolean {
  return /\/(index|main)[^/]*\.(tsx?|jsx?)$/i.test(entry.path);
}

export type TestKind = 'stub' | 'component' | 'e2e';

export interface ITestClassification {
  kind: TestKind;
  itCount: number;
  loginHelper?: string;
  mountTargets: string[];
  seeded: boolean;
  provider?: Provider;
}

/**
 * Classify a test file with structured metadata the LLM can reason about.
 *
 * - `kind: 'stub'`     — zero it-blocks AND content has no it/test/describe call.
 * - `kind: 'component'`— filename matches `*.cy.[jt]sx?` (Cypress component test).
 * - `kind: 'e2e'`      — everything else.
 *
 * `mountTargets` and `seeded` need the actual file content; `fileContent`
 * optional. When omitted they remain empty/false.
 */
export function classifyTest(
  entry: IFileEntry,
  fileContent?: string,
): ITestClassification {
  const itCount = entry.cypress?.itBlocks.length ?? 0;
  const isComponentFile = /\.cy\.(jsx?|tsx?)$/i.test(entry.path);

  const commands = entry.cypress?.customCommandsUsed ?? [];
  const loginHelper = commands.find((c) => /^login/i.test(c));

  let kind: TestKind;
  if (isComponentFile) {
    kind = 'component';
  } else if (itCount === 0 && !hasTestBlocks(fileContent)) {
    kind = 'stub';
  } else if (itCount > 0 && fileContent && allItBodiesEmpty(fileContent)) {
    kind = 'stub';
  } else {
    kind = 'e2e';
  }

  const mountTargets: string[] = [];
  let seeded = false;
  if (fileContent) {
    const mountRe = /cy\.mount\s*\(\s*<\s*([A-Z][A-Za-z0-9_]+)/g;
    for (const m of fileContent.matchAll(mountRe)) mountTargets.push(m[1]);
    seeded = /cy\.task\(\s*['"]db:seed/.test(fileContent);
  }

  const base = path.basename(entry.path).toLowerCase();
  const provider = (PROVIDERS.find((p) => base.includes(p))
    ?? (loginHelper
      ? PROVIDERS.find((p) => loginHelper.toLowerCase().includes(p))
      : undefined));

  return {
    kind,
    itCount,
    loginHelper,
    mountTargets: [...new Set(mountTargets)],
    seeded,
    provider,
  };
}

function hasTestBlocks(content?: string): boolean {
  if (!content) return false;
  return /\b(it|test|describe)\s*\(/.test(content);
}

/**
 * True when every `it(...)` / `test(...)` block in `content` has an empty body
 * (only whitespace and comments). Used to detect stub specs whose `it` blocks
 * exist but do nothing — e.g. Cypress Studio scaffolds.
 *
 * Uses a brace-balanced walk, so nested braces in arrow bodies are tolerated.
 */
function allItBodiesEmpty(content: string): boolean {
  const blockRe = /\b(?:it|test)\s*\(/g;
  let found = false;

  for (const m of content.matchAll(blockRe)) {
    found = true;
    const start = m.index! + m[0].length;
    const openParen = findBodyOpenBrace(content, start);
    if (openParen < 0) return false;
    const body = extractBalancedBody(content, openParen);
    if (body === null) return false;
    if (!isCommentOrWhitespace(body)) return false;
  }
  return found;
}

/**
 * Walk from `from` until we find the `{` that opens the it-block body,
 * skipping past the string arg and the callback's param list / `=>`.
 */
function findBodyOpenBrace(content: string, from: number): number {
  let depth = 0;
  for (let i = from; i < content.length; i++) {
    const ch = content[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) return -1;
      depth--;
    } else if (ch === '{' && depth === 0) {
      return i;
    }
  }
  return -1;
}

function extractBalancedBody(content: string, openBrace: number): string | null {
  let depth = 0;
  for (let i = openBrace; i < content.length; i++) {
    const ch = content[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return content.slice(openBrace + 1, i);
    }
  }
  return null;
}

function isCommentOrWhitespace(body: string): boolean {
  const stripped = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  return stripped.trim() === '';
}

/**
 * Structured metadata header for a source file. Prepended to the source block
 * so the LLM sees concrete, checkable flags (provider, entry-point) before the
 * code sample.
 */
export function buildSourceHeader(entry: IFileEntry): string {
  const provider = detectSourceProvider(entry);
  const entryPoint = isSourceEntryPoint(entry);
  const lines = [
    'SOURCE METADATA:',
    `- path: ${entry.path}`,
    provider ? `- provider: ${provider}` : undefined,
    entryPoint ? `- entry_point: true` : undefined,
    entry.exports.length ? `- exports: ${entry.exports.slice(0, 10).join(', ')}` : undefined,
  ].filter(Boolean);
  return lines.join('\n');
}

/**
 * Structured metadata header for a test file. Gives the LLM a compact,
 * structured summary the prompt's decision rubric can reference by key.
 */
export function buildTestHeader(entry: IFileEntry, fileContent?: string): string {
  const c = classifyTest(entry, fileContent);
  const visits = entry.cypress?.visitedRoutes?.slice(0, 6).join(', ');
  const describes = entry.cypress?.describeBlocks?.slice(0, 3).join(' > ');

  const lines = [
    'TEST METADATA:',
    `- path: ${entry.path}`,
    `- kind: ${c.kind}`,
    `- it_count: ${c.itCount}`,
    c.loginHelper ? `- login_helper: ${c.loginHelper}` : undefined,
    c.mountTargets.length ? `- mount_targets: ${c.mountTargets.join(', ')}` : undefined,
    c.seeded ? `- seeded: true` : undefined,
    c.provider ? `- provider: ${c.provider}` : undefined,
    describes ? `- describes: ${describes}` : undefined,
    visits ? `- visits: ${visits}` : undefined,
  ].filter(Boolean);
  return lines.join('\n');
}

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
