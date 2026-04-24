// Directory tokens that are structural, not semantic. They appear across
// unrelated features, so they must not count when deciding whether two
// files share a feature root. Centralised so every scorer that compares
// paths uses the same judgement.
const STRUCTURAL_DIR_TOKENS = new Set([
  'src',
  'lib',
  'app',
  'apps',
  'packages',
  'webapp',
  'channels',
  'e2e',
  'e2e-tests',
  'cypress',
  'tests',
  'test',
  'integration',
  'specs',
  'spec',
  'components',
  'pages',
  'page',
  'views',
  'containers',
  'utils',
  'helpers',
  'hooks',
  'actions',
  'reducers',
  'selectors',
  'services',
  'types',
  'constants',
  'config',
]);

const STOPWORDS = new Set(['test', 'tests', 'spec', 'specs', 'the', 'of', 'for', 'with', 'cy']);

const MIN_TOKEN_LEN = 2;

function splitTokens(raw: string): string[] {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

export function featureDirTokens(filePath: string): Set<string> {
  const segments = filePath.split(/[\\/]/).slice(0, -1);
  const out = new Set<string>();
  for (const seg of segments) {
    for (const tok of splitTokens(seg)) {
      if (tok.length < MIN_TOKEN_LEN) continue;
      if (STOPWORDS.has(tok)) continue;
      if (STRUCTURAL_DIR_TOKENS.has(tok)) continue;
      out.add(tok);
    }
  }
  return out;
}

/**
 * Falls back to basename tokens (minus the test suffix) when the file's
 * ancestor dirs are all structural — e.g. `src/actions/burn_on_read_websocket.ts`
 * has feature dirs = ∅, but the basename itself carries feature identity.
 * Without this fallback the gate would auto-pass and collisions would leak.
 */
function featureIdentity(filePath: string): Set<string> {
  const dirs = featureDirTokens(filePath);
  if (dirs.size > 0) return dirs;

  const basename = filePath
    .split(/[\\/]/)
    .slice(-1)[0]
    .replace(/\.(cy|spec|test|e2e|int|integration|unit)\.(ts|js)x?$/i, '')
    .replace(/\.[a-z]+$/i, '');

  const out = new Set<string>();
  for (const tok of splitTokens(basename)) {
    if (tok.length < MIN_TOKEN_LEN) continue;
    if (STOPWORDS.has(tok)) continue;
    out.add(tok);
  }
  return out;
}

/**
 * Two paths share a feature dir when any non-structural directory token is
 * shared. `STRUCTURAL_DIR_TOKENS` (src, components, utils, webapp…) are
 * filtered because they appear across unrelated features and would make
 * every pair look "shared".
 *
 * Fallback: if either side has no feature tokens at all (e.g. file lives
 * directly under `src/`), we can't decide — return true so the caller
 * doesn't block a legitimate match.
 *
 *   backstage_category.tsx  → {backstage}
 *   channel_sidebar/*_spec  → {channel, sidebar} → no overlap → false
 *
 *   utils/dialog_conversion.ts → {dialog, conversion}
 *   interactive_dialog/*_spec  → {interactive, dialog} → overlap on `dialog` → true
 */
export function sharesFeatureDir(pathA: string, pathB: string): boolean {
  const a = featureIdentity(pathA);
  const b = featureIdentity(pathB);
  if (a.size === 0 || b.size === 0) return true;
  for (const t of a) if (b.has(t)) return true;
  return false;
}
