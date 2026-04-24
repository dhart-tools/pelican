import * as fsSync from 'fs';
import * as path from 'path';

import * as ts from 'typescript';

export interface ITsConfigAliases {
  /** Alias prefix (with trailing `/`) → directory relative to projectRoot. */
  aliases: Record<string, string>;
  /** Directories (project-relative) that act as bare-import roots (tsconfig `baseUrl`). */
  baseUrlRoots: string[];
}

/**
 * Walks each sourceDir upward to find the nearest `tsconfig.json`, follows
 * `references` one level deep, and extracts:
 *   - `compilerOptions.paths` → alias map (key `foo/*` becomes prefix `foo/`)
 *   - `compilerOptions.baseUrl` → bare-import search root
 *
 * Example: mattermost's `webapp/channels/tsconfig.json` sets `baseUrl: ./src`,
 * so `import X from 'components/foo'` must resolve against
 * `webapp/channels/src/components/foo`. Without this the registry loses 80%+
 * of import edges on any repo that uses `baseUrl`.
 */
export function loadTsConfigAliases(
  projectRoot: string,
  sourceDirs: string[],
  debug?: (msg: string) => void,
): ITsConfigAliases {
  const aliases: Record<string, string> = {};
  const baseUrlRoots = new Set<string>();
  const visited = new Set<string>();

  const candidates = findCandidateTsConfigs(projectRoot, sourceDirs);
  for (const configPath of candidates) {
    ingestTsConfig(configPath, projectRoot, aliases, baseUrlRoots, visited, debug);
  }

  return { aliases, baseUrlRoots: Array.from(baseUrlRoots) };
}

function findCandidateTsConfigs(projectRoot: string, sourceDirs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const rootConfig = path.join(projectRoot, 'tsconfig.json');
  if (fsSync.existsSync(rootConfig)) {
    seen.add(rootConfig);
    out.push(rootConfig);
  }

  for (const dir of sourceDirs) {
    let cur = path.resolve(projectRoot, dir);
    while (true) {
      const candidate = path.join(cur, 'tsconfig.json');
      if (fsSync.existsSync(candidate) && !seen.has(candidate)) {
        seen.add(candidate);
        out.push(candidate);
      }
      const parent = path.dirname(cur);
      if (parent === cur || !parent.startsWith(projectRoot)) break;
      cur = parent;
    }
  }

  return out;
}

function ingestTsConfig(
  configPath: string,
  projectRoot: string,
  aliases: Record<string, string>,
  baseUrlRoots: Set<string>,
  visited: Set<string>,
  debug?: (msg: string) => void,
): void {
  if (visited.has(configPath)) return;
  visited.add(configPath);

  let raw: string;
  try {
    raw = fsSync.readFileSync(configPath, 'utf-8');
  } catch {
    return;
  }

  const { config, error } = ts.parseConfigFileTextToJson(configPath, raw);
  if (error || !config) {
    if (debug) debug(`tsconfig parse failed: ${configPath}`);
    return;
  }

  const configDir = path.dirname(configPath);
  const compilerOptions = (config.compilerOptions ?? {}) as {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };

  let absBaseUrl: string | null = null;
  if (typeof compilerOptions.baseUrl === 'string') {
    absBaseUrl = path.resolve(configDir, compilerOptions.baseUrl);
    const relBaseUrl = toProjectRel(absBaseUrl, projectRoot);
    if (relBaseUrl && fsSync.existsSync(absBaseUrl)) {
      baseUrlRoots.add(relBaseUrl);
    }
  }

  if (compilerOptions.paths && typeof compilerOptions.paths === 'object') {
    const aliasRoot = absBaseUrl ?? configDir;
    for (const [key, values] of Object.entries(compilerOptions.paths)) {
      if (!Array.isArray(values) || values.length === 0) continue;
      const rawTarget = typeof values[0] === 'string' ? values[0] : '';
      if (!rawTarget) continue;
      const { prefix, targetRel } = normalizePathsEntry(key, rawTarget, aliasRoot, projectRoot);
      if (!prefix || !targetRel) continue;
      // Don't clobber a longer/more-specific prefix already registered.
      if (aliases[prefix] === undefined) aliases[prefix] = targetRel;
    }
  }

  // Follow project references one level — enough for the common monorepo
  // layout (mattermost: channels references platform/*). Deeper chains are
  // rare and can be added later if a real repo hits that case.
  const references = (config.references ?? []) as Array<{ path?: string }>;
  for (const ref of references) {
    if (!ref?.path) continue;
    const refResolved = resolveReferencePath(configDir, ref.path);
    if (!refResolved) continue;
    if (visited.has(refResolved)) continue;
    ingestTsConfig(refResolved, projectRoot, aliases, baseUrlRoots, visited, debug);
  }
}

function normalizePathsEntry(
  key: string,
  rawTarget: string,
  aliasRoot: string,
  projectRoot: string,
): { prefix: string; targetRel: string } {
  const keyNoGlob = key.replace(/\/?\*$/, '');
  if (!keyNoGlob) return { prefix: '', targetRel: '' };

  const prefix = keyNoGlob.endsWith('/') ? keyNoGlob : `${keyNoGlob}/`;
  const targetNoGlob = rawTarget.replace(/\/?\*$/, '');
  const absTarget = path.resolve(aliasRoot, targetNoGlob);
  const targetRel = toProjectRel(absTarget, projectRoot);
  if (!targetRel) return { prefix: '', targetRel: '' };
  return { prefix, targetRel: targetRel.endsWith('/') ? targetRel : `${targetRel}/` };
}

function resolveReferencePath(configDir: string, refPath: string): string | null {
  const abs = path.resolve(configDir, refPath);
  if (fsSync.existsSync(abs)) {
    const stat = fsSync.statSync(abs);
    if (stat.isDirectory()) {
      const nested = path.join(abs, 'tsconfig.json');
      return fsSync.existsSync(nested) ? nested : null;
    }
    if (stat.isFile()) return abs;
  }
  return null;
}

function toProjectRel(absPath: string, projectRoot: string): string {
  const rel = path.relative(projectRoot, absPath);
  if (rel.startsWith('..')) return '';
  return rel.split(path.sep).join('/');
}
