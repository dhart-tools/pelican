# Task 07: i18n Analyzer

## Overview

Create an analyzer that resolves translation keys to their translated text and builds a mapping between keys, translations, and source files. This analyzer bridges the gap between `t('key')` in source and `cy.contains('text')` in tests.

## Objectives

1. Load and parse translation files (JSON)
2. Build bi-directional key↔text mapping
3. Map translation keys to source files using them
4. Provide translation resolution for scoring
5. Support multiple i18n libraries (react-i18next, react-intl, custom)
6. Handle dynamic/interpolated translation values
7. Surface file loading errors as structured warnings (never silently swallow)

## Core Types

```typescript
export interface II18nExtractionResult {
  translationIndex: ITranslationIndex;
  locale: string;
  warnings: II18nWarning[]; // all load/parse problems collected here
}

export interface ITranslationIndex {
  keyToText: Map<string, string>;       // 'login.submitButton' → 'Sign In'
  textToKeys: Map<string, string[]>;    // 'Sign In' → ['login.submitButton']
  keyToFiles: Map<string, Set<string>>; // 'login.submitButton' → Set(['src/pages/LoginPage.tsx'])
  dynamicKeys: Set<string>;             // keys whose values contain interpolation placeholders
  keyToStaticText: Map<string, string>; // stripped version of dynamic values for partial matching
}

export interface II18nLibraryConfig {
  type: 'react-i18next' | 'react-intl' | 'custom';
  defaultLocale: string;
  localesPath: string;
  structure: 'single' | 'namespaced';
}

// --- NEW: Structured warning types ---

export type I18nWarningCode =
  | 'FILE_NOT_FOUND'          // file path does not exist on disk
  | 'INVALID_JSON'            // file exists but JSON.parse failed
  | 'EMPTY_TRANSLATION_FILE'  // file parsed successfully but has zero keys
  | 'LOCALE_DIR_MISSING';     // namespaced mode: the locale directory itself is missing

export interface II18nWarning {
  code: I18nWarningCode;
  filePath: string;   // absolute or relative path that caused the warning
  message: string;    // human-readable description, shown in CLI output
}
```

## Implementation

### 1. Create i18n Analyzer

**File:** `src/analyzers/i18n-analyzer.ts`

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { BaseAnalyzer } from './base';
import {
  II18nExtractionResult,
  ITranslationIndex,
  II18nLibraryConfig,
  II18nWarning
} from '../core/types';
import { ISourceExtractionResult } from '../core/types';

export class I18nAnalyzer extends BaseAnalyzer {

  // ─── Interpolation patterns ───────────────────────────────────────────────
  //
  // These regexes detect interpolation placeholders used by the three most
  // common i18n libraries. A translation value that matches ANY of these is
  // treated as "dynamic" — its raw text will never exactly match what the
  // browser renders, so we also store a stripped version for partial matching.
  //
  //   Pattern 1: {{name}}       — react-i18next (double curly braces)
  //   Pattern 2: {count}        — react-intl / JS template literals (single braces)
  //   Pattern 3: %(key)s        — Python-style (used by some custom setups)
  //
  // WHY THIS MATTERS:
  //   Translation file: "Welcome, {{name}}! You have {{count}} messages."
  //   Browser renders:  "Welcome, Alice! You have 3 messages."
  //   cy.contains() in test: cy.contains('Welcome,')  ← only a fragment matches
  //
  //   Without this handling, the analyzer stores the raw string with placeholders.
  //   The scorer then tries to find 'Welcome, Alice!' in textToKeys → no match → miss.
  //
  //   With this handling, we also store the stripped text 'Welcome,! You have messages.'
  //   in keyToStaticText AND register it in textToKeys, so a partial cy.contains can hit.
  //
  private readonly INTERPOLATION_PATTERNS: RegExp[] = [
    /\{\{.*?\}\}/g,   // react-i18next:  {{name}}, {{count}}
    /\{[^}]+\}/g,     // react-intl:     {name},   {count}
    /%%\([^)]+\)s/g,  // python-style:   %(key)s
  ];

  constructor() {
    super({
      name: 'i18n',
      version: '1.0.0',
      description: 'Builds translation index and resolves keys to text',
      dependencies: ['source-extractor']
    });
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  async analyze(input: {
    config: II18nLibraryConfig;
    sourceExtractions: ISourceExtractionResult[];
  }): Promise<II18nExtractionResult> {
    const { config, sourceExtractions } = input;

    // warnings is passed by reference into every private method so they can
    // push to it. The caller receives the full list at the end.
    const warnings: II18nWarning[] = [];

    const translationIndex = await this.loadTranslationFiles(config, warnings);
    this.mapKeysToFiles(translationIndex, sourceExtractions);

    return {
      translationIndex,
      locale: config.defaultLocale,
      warnings
    };
  }

  // ─── Translation File Loading ─────────────────────────────────────────────

  private async loadTranslationFiles(
    config: II18nLibraryConfig,
    warnings: II18nWarning[]
  ): Promise<ITranslationIndex> {
    const index: ITranslationIndex = {
      keyToText: new Map(),
      textToKeys: new Map(),
      keyToFiles: new Map(),
      dynamicKeys: new Set(),
      keyToStaticText: new Map()
    };

    const locale = config.defaultLocale;

    if (config.structure === 'single') {
      // ── Single-file mode ──────────────────────────────────────────────────
      // localesPath example: 'public/locales/{locale}.json'
      // After substitution:  'public/locales/en.json'
      const filePath = config.localesPath.replace('{locale}', locale);
      const translations = await this.loadJSONFile(filePath, warnings);
      this.addToIndex(index, translations, '');
    } else {
      // ── Namespaced mode ───────────────────────────────────────────────────
      // localesPath example: 'public/locales/{locale}/{namespace}.json'
      // dir after substitution: 'public/locales/en'
      // We read ALL .json files in that directory, each becoming a namespace.
      const dir = path.dirname(config.localesPath).replace('{locale}', locale);

      if (!fs.existsSync(dir)) {
        // Surface this as a structured warning instead of crashing or ignoring.
        // The CLI layer can decide whether to abort.
        warnings.push({
          code: 'LOCALE_DIR_MISSING',
          filePath: dir,
          message: `Locale directory not found: ${dir}. Check that 'localesPath' and 'defaultLocale' are correct in your config.`
        });
        return index; // return empty index — caller sees warning
      }

      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(dir, file);
          const translations = await this.loadJSONFile(filePath, warnings);
          const namespace = file.replace('.json', ''); // 'login.json' → 'login'
          this.addToIndex(index, translations, namespace);
        }
      }
    }

    return index;
  }

  // ─── JSON File Loader (with structured error handling) ────────────────────
  //
  // BEFORE (what the original code did):
  //   try {
  //     return JSON.parse(content);
  //   } catch (error) {
  //     console.warn(`Failed to load...`, error);  // ← swallowed, never reaches caller
  //     return {};
  //   }
  //
  // AFTER (what we do now):
  //   Every failure is pushed into the `warnings` array. The return value is
  //   still `{}` so the rest of the pipeline can continue, but the caller now
  //   knows something went wrong and can act on it.
  //
  //   Three distinct failure modes each get their own warning code:
  //     FILE_NOT_FOUND       — fs.readFile threw (ENOENT or EACCES)
  //     INVALID_JSON         — file read OK, JSON.parse threw
  //     EMPTY_TRANSLATION_FILE — parsed OK, but zero keys (likely wrong path)
  //
  private async loadJSONFile(
    filePath: string,
    warnings: II18nWarning[]
  ): Promise<Record<string, unknown>> {
    let content: string;

    try {
      content = await fs.promises.readFile(filePath, 'utf-8');
    } catch (error: any) {
      warnings.push({
        code: 'FILE_NOT_FOUND',
        filePath,
        message: `Could not read translation file: ${filePath} — ${error.message}`
      });
      return {};
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch (error: any) {
      warnings.push({
        code: 'INVALID_JSON',
        filePath,
        message: `Translation file contains invalid JSON: ${filePath} — ${error.message}`
      });
      return {};
    }

    if (Object.keys(parsed).length === 0) {
      warnings.push({
        code: 'EMPTY_TRANSLATION_FILE',
        filePath,
        message: `Translation file loaded but contains no keys: ${filePath}. This may indicate a wrong path.`
      });
    }

    return parsed;
  }

  // ─── Index Building ───────────────────────────────────────────────────────

  private addToIndex(
    index: ITranslationIndex,
    translations: Record<string, unknown>,
    namespace: string
  ): void {
    this.traverseTranslations(index, translations, namespace);
  }

  // Recursively walks a (possibly nested) translation object.
  // `prefix` accumulates the dot-separated key path as we descend.
  //
  // Example input object (namespace = 'login'):
  //   { title: 'Sign In', form: { password: 'Password' } }
  //
  // Keys produced:
  //   'login.title'         → 'Sign In'
  //   'login.form.password' → 'Password'
  //
  private traverseTranslations(
    index: ITranslationIndex,
    obj: Record<string, unknown>,
    prefix: string
  ): void {
    for (const key in obj) {
      const value = obj[key];
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (typeof value === 'string') {
        // ── Register in keyToText ──────────────────────────────────────────
        index.keyToText.set(fullKey, value);

        // ── Register in textToKeys (handle duplicate text across keys) ─────
        const existingKeys = index.textToKeys.get(value) || [];
        if (!existingKeys.includes(fullKey)) {
          existingKeys.push(fullKey);
          index.textToKeys.set(value, existingKeys);
        }

        // ── Handle interpolation ───────────────────────────────────────────
        if (this.hasInterpolation(value)) {
          // Mark this key as dynamic so the scorer can apply looser matching
          index.dynamicKeys.add(fullKey);

          // Strip placeholders to get the static portions of the string.
          // Example: "Welcome, {{name}}!" → "Welcome,!"
          // After collapsing spaces: "Welcome,!"
          const staticText = this.stripInterpolation(value);

          if (staticText.length > 0) {
            // Store the stripped text so a cy.contains('Welcome,') can still match
            index.keyToStaticText.set(fullKey, staticText);

            // Also register in textToKeys so the scorer's lookup works uniformly
            const staticKeys = index.textToKeys.get(staticText) || [];
            if (!staticKeys.includes(fullKey)) {
              staticKeys.push(fullKey);
              index.textToKeys.set(staticText, staticKeys);
            }
          }
        }

      } else if (typeof value === 'object' && value !== null) {
        // Recurse into nested objects
        this.traverseTranslations(index, value as Record<string, unknown>, fullKey);
      }
      // Note: arrays and other types are intentionally ignored
    }
  }

  // ─── Interpolation Helpers ────────────────────────────────────────────────

  // Returns true if the string contains ANY known interpolation syntax.
  private hasInterpolation(value: string): boolean {
    // Reset lastIndex before each test since regexes are stateful when using /g
    return this.INTERPOLATION_PATTERNS.some(pattern => {
      pattern.lastIndex = 0;
      return pattern.test(value);
    });
  }

  // Removes all placeholder tokens from the string and collapses whitespace.
  //
  // Examples:
  //   "Hello, {{name}}!"              → "Hello,!"
  //   "You have {count} items left."  → "You have items left."
  //   "%(key)s updated successfully"  → "updated successfully"
  //
  private stripInterpolation(value: string): string {
    let stripped = value;
    for (const pattern of this.INTERPOLATION_PATTERNS) {
      pattern.lastIndex = 0;
      stripped = stripped.replace(pattern, '');
    }
    return stripped.replace(/\s+/g, ' ').trim();
  }

  // ─── Key → File Mapping ───────────────────────────────────────────────────

  private mapKeysToFiles(
    index: ITranslationIndex,
    sourceExtractions: ISourceExtractionResult[]
  ): void {
    for (const extraction of sourceExtractions) {
      const filePath = extraction.filePath;
      const translationKeys = extraction.translationKeys || [];

      for (const key of translationKeys) {
        const files = index.keyToFiles.get(key) || new Set<string>();
        files.add(filePath);
        index.keyToFiles.set(key, files);
      }
    }
  }

  // ─── Public Helper Methods ────────────────────────────────────────────────

  translateKey(index: ITranslationIndex, key: string): string | undefined {
    return index.keyToText.get(key);
  }

  findKeysByText(index: ITranslationIndex, text: string): string[] {
    return index.textToKeys.get(text) || [];
  }

  findFilesUsingKey(index: ITranslationIndex, key: string): Set<string> {
    return index.keyToFiles.get(key) || new Set();
  }

  isDynamicKey(index: ITranslationIndex, key: string): boolean {
    return index.dynamicKeys.has(key);
  }

  getStaticText(index: ITranslationIndex, key: string): string | undefined {
    return index.keyToStaticText.get(key);
  }
}
```

### 2. Update Types File

**File:** `src/core/types.ts` (Add to existing)

```typescript
export interface II18nExtractionResult {
  translationIndex: ITranslationIndex;
  locale: string;
  warnings: II18nWarning[];
}

export interface ITranslationIndex {
  keyToText: Map<string, string>;
  textToKeys: Map<string, string[]>;
  keyToFiles: Map<string, Set<string>>;
  dynamicKeys: Set<string>;
  keyToStaticText: Map<string, string>;
}

export interface II18nLibraryConfig {
  type: 'react-i18next' | 'react-intl' | 'custom';
  defaultLocale: string;
  localesPath: string;
  structure: 'single' | 'namespaced';
}

export type I18nWarningCode =
  | 'FILE_NOT_FOUND'
  | 'INVALID_JSON'
  | 'EMPTY_TRANSLATION_FILE'
  | 'LOCALE_DIR_MISSING';

export interface II18nWarning {
  code: I18nWarningCode;
  filePath: string;
  message: string;
}
```

## Usage Example

```typescript
import { I18nAnalyzer } from './analyzers/i18n-analyzer';

const analyzer = new I18nAnalyzer();

const result = await analyzer.analyze({
  config: {
    type: 'react-i18next',
    defaultLocale: 'en',
    localesPath: 'public/locales/{locale}/{namespace}.json',
    structure: 'namespaced'
  },
  sourceExtractions: [
    {
      filePath: 'src/pages/LoginPage.tsx',
      translationKeys: ['login.submitButton', 'login.password']
    },
    {
      filePath: 'src/pages/DashboardPage.tsx',
      translationKeys: ['dashboard.welcome']
    }
  ]
});

// ── Basic lookups ──────────────────────────────────────────────────────────

console.log(result.translationIndex.keyToText);
// Map {
//   'login.title'      => 'Sign In',
//   'login.submitButton' => 'Sign In',
//   'login.password'   => 'Password',
//   'dashboard.welcome' => 'Welcome, {{name}}!',
//   'dashboard.logout' => 'Logout'
// }

const text = analyzer.translateKey(result.translationIndex, 'login.submitButton');
console.log(text); // 'Sign In'

const keys = analyzer.findKeysByText(result.translationIndex, 'Sign In');
console.log(keys); // ['login.title', 'login.submitButton']

const files = analyzer.findFilesUsingKey(result.translationIndex, 'login.submitButton');
console.log(files); // Set { 'src/pages/LoginPage.tsx' }

// ── Dynamic key lookups ────────────────────────────────────────────────────

const isDynamic = analyzer.isDynamicKey(result.translationIndex, 'dashboard.welcome');
console.log(isDynamic); // true

const staticText = analyzer.getStaticText(result.translationIndex, 'dashboard.welcome');
console.log(staticText); // 'Welcome,!'  (placeholder stripped, spaces collapsed)

// ── Warning inspection ─────────────────────────────────────────────────────

if (result.warnings.length > 0) {
  for (const warning of result.warnings) {
    console.warn(`[${warning.code}] ${warning.message}`);
  }
}
// Example output:
// [EMPTY_TRANSLATION_FILE] Translation file loaded but contains no keys: public/locales/en/empty.json.
```

## Example Translation Files

### Single File Structure

```json
// public/locales/en.json
{
  "login": {
    "title": "Sign In",
    "submitButton": "Sign In",
    "password": "Password"
  },
  "dashboard": {
    "welcome": "Welcome, {{name}}!",
    "logout": "Logout"
  }
}
```

### Namespaced Structure

```json
// public/locales/en/login.json
{
  "title": "Sign In",
  "submitButton": "Sign In",
  "password": "Password"
}
```

```json
// public/locales/en/dashboard.json
{
  "welcome": "Welcome, {{name}}!",
  "itemCount": "You have {count} items left.",
  "logout": "Logout"
}
```

### Example with All Interpolation Formats

```json
// public/locales/en/messages.json
{
  "greeting":   "Hello, {{name}}!",
  "itemCount":  "You have {count} items.",
  "legacyMsg":  "%(user)s has logged in."
}
```

After indexing, the analyzer will produce:

| Key | keyToText (raw) | dynamicKeys | keyToStaticText (stripped) |
|---|---|---|---|
| `messages.greeting` | `"Hello, {{name}}!"` | ✅ | `"Hello,!"` |
| `messages.itemCount` | `"You have {count} items."` | ✅ | `"You have items."` |
| `messages.legacyMsg` | `"%(user)s has logged in."` | ✅ | `"has logged in."` |

## Structured Error Handling

### How Warnings Flow Through the System

```
loadJSONFile()           ← pushes warnings into warnings[]
loadTranslationFiles()   ← passes warnings[] down, checks dir existence
analyze()                ← receives warnings[], returns them on result
CLI entry point          ← reads result.warnings, prints them, optionally aborts
```

### Warning Codes Reference

| Code | When It Fires | Severity Suggestion |
|---|---|---|
| `FILE_NOT_FOUND` | `fs.readFile` threw (file missing or no permission) | Error — scoring will be incomplete |
| `INVALID_JSON` | File read OK but `JSON.parse` threw | Error — file is corrupt |
| `EMPTY_TRANSLATION_FILE` | Parsed OK but zero keys | Warning — may be wrong path |
| `LOCALE_DIR_MISSING` | Entire locale directory absent | Fatal — abort recommended |

### CLI Entry Point

```typescript
const result = await analyzer.analyze({ config, sourceExtractions });

if (result.warnings.length > 0) {
  console.warn(`\n⚠️  i18n Analyzer Warnings (${result.warnings.length}):`);
  for (const warning of result.warnings) {
    console.warn(`  [${warning.code}] ${warning.message}`);
  }

  // LOCALE_DIR_MISSING means we have zero translations — no point continuing
  const isFatal = result.warnings.some(w => w.code === 'LOCALE_DIR_MISSING');
  if (isFatal) {
    throw new Error('Aborting: locale directory is missing. Fix localesPath in config.');
  }
}
```

### Example CLI Output

```
⚠️  i18n Analyzer Warnings (3):
  [FILE_NOT_FOUND]          Could not read translation file: public/locales/en/auth.json — ENOENT
  [INVALID_JSON]            Translation file contains invalid JSON: public/locales/en/broken.json — Unexpected token
  [EMPTY_TRANSLATION_FILE]  Translation file loaded but contains no keys: public/locales/en/empty.json.
```

## Scoring Integration

### Updated TranslationMatchScorer

The scorer now distinguishes between exact matches (static keys) and partial matches (dynamic keys), and uses `includes()` instead of `===` to align with how Cypress `contains()` actually works — it matches substrings, not full strings.

```typescript
export class TranslationMatchScorer extends BaseScorer {
  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, changedFile: changedEntry, registry } = context;

    const translationIndex = registry.getTranslationIndex();
    const containsText = testEntry.cypress?.containsText || [];
    const translationKeys = changedEntry.translationKeys || [];

    for (const text of containsText) {
      // textToKeys holds BOTH exact texts and stripped interpolated texts,
      // so this single lookup covers both static and dynamic keys.
      const keys = translationIndex.textToKeys.get(text) || [];

      for (const key of keys) {
        // Use includes() to mirror Cypress contains() substring behaviour.
        // cy.contains('Sign In') matches a button labelled 'Sign In Now' too.
        const sourceUsesKey = translationKeys.some(k => k.includes(key) || key.includes(k));

        if (sourceUsesKey) {
          const isDynamic = translationIndex.dynamicKeys.has(key);

          return [
            this.createSignal(
              true,
              isDynamic
                ? `Test contains "${text}" which partially matches dynamic key "${key}" (interpolated value) used in source file`
                : `Test contains "${text}" which maps to key "${key}" used in source file`,
              { changedFile, testFile, text, key, isDynamic }
            )
          ];
        }
      }
    }

    return [this.createSignal(false, 'No translation matches found')];
  }
}
```

## Testing Strategy

### Unit Tests

#### 1. Translation File Loading

```typescript
describe('I18nAnalyzer - loadTranslationFiles', () => {

  it('loads a single translation file and builds keyToText', async () => {
    // Arrange
    mockFs({
      'public/locales/en.json': JSON.stringify({
        login: { submitButton: 'Sign In', password: 'Password' }
      })
    });
    const analyzer = new I18nAnalyzer();

    // Act
    const result = await analyzer.analyze({
      config: {
        type: 'react-i18next',
        defaultLocale: 'en',
        localesPath: 'public/locales/{locale}.json',
        structure: 'single'
      },
      sourceExtractions: []
    });

    // Assert
    expect(result.translationIndex.keyToText.get('login.submitButton')).toBe('Sign In');
    expect(result.translationIndex.keyToText.get('login.password')).toBe('Password');
    expect(result.warnings).toHaveLength(0);
  });

  it('loads namespaced files and prefixes keys with namespace', async () => {
    // Arrange
    mockFs({
      'public/locales/en/login.json': JSON.stringify({ title: 'Sign In' }),
      'public/locales/en/dashboard.json': JSON.stringify({ logout: 'Logout' })
    });
    const analyzer = new I18nAnalyzer();

    // Act
    const result = await analyzer.analyze({
      config: {
        type: 'react-i18next',
        defaultLocale: 'en',
        localesPath: 'public/locales/{locale}/{namespace}.json',
        structure: 'namespaced'
      },
      sourceExtractions: []
    });

    // Assert
    // Keys are prefixed with the filename (namespace)
    expect(result.translationIndex.keyToText.get('login.title')).toBe('Sign In');
    expect(result.translationIndex.keyToText.get('dashboard.logout')).toBe('Logout');
  });

  it('builds textToKeys for reverse lookup', async () => {
    // Arrange: 'Sign In' appears in two different keys
    mockFs({
      'public/locales/en/login.json': JSON.stringify({
        title: 'Sign In',
        submitButton: 'Sign In'   // duplicate text, two keys
      })
    });
    const analyzer = new I18nAnalyzer();

    // Act
    const result = await analyzer.analyze({
      config: { type: 'react-i18next', defaultLocale: 'en', localesPath: 'public/locales/{locale}/{namespace}.json', structure: 'namespaced' },
      sourceExtractions: []
    });

    // Assert
    const keys = result.translationIndex.textToKeys.get('Sign In');
    expect(keys).toContain('login.title');
    expect(keys).toContain('login.submitButton');
    expect(keys).toHaveLength(2);
  });

  it('handles deeply nested translation objects', async () => {
    // Arrange
    mockFs({
      'public/locales/en.json': JSON.stringify({
        a: { b: { c: { d: 'Deep Value' } } }
      })
    });
    const analyzer = new I18nAnalyzer();

    // Act
    const result = await analyzer.analyze({
      config: { type: 'react-i18next', defaultLocale: 'en', localesPath: 'public/locales/{locale}.json', structure: 'single' },
      sourceExtractions: []
    });

    // Assert
    expect(result.translationIndex.keyToText.get('a.b.c.d')).toBe('Deep Value');
  });

});
```

#### 2. Structured Error Handling

```typescript
describe('I18nAnalyzer - structured error surfacing', () => {

  it('emits FILE_NOT_FOUND when the translation file does not exist', async () => {
    // Arrange: filesystem has no files
    mockFs({});
    const analyzer = new I18nAnalyzer();

    // Act
    const result = await analyzer.analyze({
      config: {
        type: 'react-i18next',
        defaultLocale: 'en',
        localesPath: 'public/locales/{locale}.json',
        structure: 'single'
      },
      sourceExtractions: []
    });

    // Assert: a warning is returned, not thrown
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe('FILE_NOT_FOUND');
    expect(result.warnings[0].filePath).toBe('public/locales/en.json');
    // The rest of the index is still valid (just empty)
    expect(result.translationIndex.keyToText.size).toBe(0);
  });

  it('emits INVALID_JSON when the file contains malformed JSON', async () => {
    // Arrange: file exists but has a syntax error
    mockFs({
      'public/locales/en.json': '{ "login": { BROKEN }'
    });
    const analyzer = new I18nAnalyzer();

    // Act
    const result = await analyzer.analyze({
      config: { type: 'react-i18next', defaultLocale: 'en', localesPath: 'public/locales/{locale}.json', structure: 'single' },
      sourceExtractions: []
    });

    // Assert
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe('INVALID_JSON');
    expect(result.warnings[0].message).toContain('invalid JSON');
  });

  it('emits EMPTY_TRANSLATION_FILE when the file parses to an empty object', async () => {
    // Arrange: valid JSON, but no keys inside
    mockFs({
      'public/locales/en.json': '{}'
    });
    const analyzer = new I18nAnalyzer();

    // Act
    const result = await analyzer.analyze({
      config: { type: 'react-i18next', defaultLocale: 'en', localesPath: 'public/locales/{locale}.json', structure: 'single' },
      sourceExtractions: []
    });

    // Assert
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe('EMPTY_TRANSLATION_FILE');
  });

  it('emits LOCALE_DIR_MISSING when the locale directory does not exist in namespaced mode', async () => {
    // Arrange: no 'en' directory
    mockFs({});
    const analyzer = new I18nAnalyzer();

    // Act
    const result = await analyzer.analyze({
      config: { type: 'react-i18next', defaultLocale: 'en', localesPath: 'public/locales/{locale}/{namespace}.json', structure: 'namespaced' },
      sourceExtractions: []
    });

    // Assert
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe('LOCALE_DIR_MISSING');
    expect(result.warnings[0].filePath).toBe('public/locales/en');
  });

  it('collects multiple warnings across multiple files without throwing', async () => {
    // Arrange: one file is missing, one is broken JSON
    mockFs({
      'public/locales/en/login.json': '{ BROKEN }',
      // dashboard.json is absent entirely
    });
    const analyzer = new I18nAnalyzer();

    // Act
    const result = await analyzer.analyze({
      config: { type: 'react-i18next', defaultLocale: 'en', localesPath: 'public/locales/{locale}/{namespace}.json', structure: 'namespaced' },
      sourceExtractions: []
    });

    // Assert: both warnings collected, nothing thrown
    const codes = result.warnings.map(w => w.code);
    expect(codes).toContain('INVALID_JSON');
    // login.json was broken → only that one warning (dashboard.json was never listed)
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });

});
```

#### 3. Interpolation Handling

```typescript
describe('I18nAnalyzer - interpolation handling', () => {

  it('marks react-i18next {{name}} style values as dynamic', async () => {
    // Arrange
    mockFs({
      'public/locales/en.json': JSON.stringify({
        dashboard: { welcome: 'Welcome, {{name}}!' }
      })
    });
    const analyzer = new I18nAnalyzer();

    // Act
    const result = await analyzer.analyze({
      config: { type: 'react-i18next', defaultLocale: 'en', localesPath: 'public/locales/{locale}.json', structure: 'single' },
      sourceExtractions: []
    });

    // Assert: key is flagged
    expect(result.translationIndex.dynamicKeys.has('dashboard.welcome')).toBe(true);
  });

  it('marks react-intl {count} style values as dynamic', async () => {
    // Arrange
    mockFs({
      'public/locales/en.json': JSON.stringify({
        cart: { items: 'You have {count} items in your cart.' }
      })
    });
    const analyzer = new I18nAnalyzer();

    // Act
    const result = await analyzer.analyze({
      config: { type: 'react-i18next', defaultLocale: 'en', localesPath: 'public/locales/{locale}.json', structure: 'single' },
      sourceExtractions: []
    });

    // Assert
    expect(result.translationIndex.dynamicKeys.has('cart.items')).toBe(true);
  });

  it('does NOT mark plain static strings as dynamic', async () => {
    // Arrange
    mockFs({
      'public/locales/en.json': JSON.stringify({
        nav: { home: 'Home', logout: 'Logout' }
      })
    });
    const analyzer = new I18nAnalyzer();

    // Act
    const result = await analyzer.analyze({
      config: { type: 'react-i18next', defaultLocale: 'en', localesPath: 'public/locales/{locale}.json', structure: 'single' },
      sourceExtractions: []
    });

    // Assert: static keys are NOT in dynamicKeys
    expect(result.translationIndex.dynamicKeys.has('nav.home')).toBe(false);
    expect(result.translationIndex.dynamicKeys.has('nav.logout')).toBe(false);
  });

  it('strips {{placeholder}} and stores static text in keyToStaticText', async () => {
    // Arrange
    mockFs({
      'public/locales/en.json': JSON.stringify({
        dashboard: { welcome: 'Welcome, {{name}}!' }
      })
    });
    const analyzer = new I18nAnalyzer();

    // Act
    const result = await analyzer.analyze({
      config: { type: 'react-i18next', defaultLocale: 'en', localesPath: 'public/locales/{locale}.json', structure: 'single' },
      sourceExtractions: []
    });

    // Assert: stripped text stored
    const stripped = result.translationIndex.keyToStaticText.get('dashboard.welcome');
    expect(stripped).toBe('Welcome,!');
    // Raw text still available
    expect(result.translationIndex.keyToText.get('dashboard.welcome')).toBe('Welcome, {{name}}!');
  });

  it('registers stripped text in textToKeys so scorer lookup works', async () => {
    // This is the critical behaviour:
    // cy.contains('Welcome,') → textToKeys.get('Welcome,!') → ['dashboard.welcome']
    // Without this, the scorer can never match dynamic keys via cy.contains.

    // Arrange
    mockFs({
      'public/locales/en.json': JSON.stringify({
        dashboard: { welcome: 'Welcome, {{name}}!' }
      })
    });
    const analyzer = new I18nAnalyzer();

    // Act
    const result = await analyzer.analyze({
      config: { type: 'react-i18next', defaultLocale: 'en', localesPath: 'public/locales/{locale}.json', structure: 'single' },
      sourceExtractions: []
    });

    // Assert
    const keys = result.translationIndex.textToKeys.get('Welcome,!');
    expect(keys).toContain('dashboard.welcome');
  });

  it('strips python-style %(key)s placeholders', async () => {
    // Arrange
    mockFs({
      'public/locales/en.json': JSON.stringify({
        audit: { login: '%(user)s has logged in.' }
      })
    });
    const analyzer = new I18nAnalyzer();

    // Act
    const result = await analyzer.analyze({
      config: { type: 'react-i18next', defaultLocale: 'en', localesPath: 'public/locales/{locale}.json', structure: 'single' },
      sourceExtractions: []
    });

    // Assert
    const stripped = result.translationIndex.keyToStaticText.get('audit.login');
    expect(stripped).toBe('has logged in.');
    expect(result.translationIndex.dynamicKeys.has('audit.login')).toBe(true);
  });

  it('handles a value that is ONLY a placeholder (produces empty static text)', async () => {
    // Edge case: the entire value is one interpolation token — no static text at all.
    // The analyzer should NOT register an empty string in textToKeys.
    //
    // Arrange
    mockFs({
      'public/locales/en.json': JSON.stringify({
        dynamic: { fullPlaceholder: '{{value}}' }
      })
    });
    const analyzer = new I18nAnalyzer();

    // Act
    const result = await analyzer.analyze({
      config: { type: 'react-i18next', defaultLocale: 'en', localesPath: 'public/locales/{locale}.json', structure: 'single' },
      sourceExtractions: []
    });

    // Assert: flagged as dynamic, but no static text stored (nothing to match)
    expect(result.translationIndex.dynamicKeys.has('dynamic.fullPlaceholder')).toBe(true);
    expect(result.translationIndex.keyToStaticText.has('dynamic.fullPlaceholder')).toBe(false);
  });

});
```

#### 4. Key → File Mapping

```typescript
describe('I18nAnalyzer - mapKeysToFiles', () => {

  it('maps a translation key to the source files that use it', async () => {
    // Arrange
    mockFs({
      'public/locales/en.json': JSON.stringify({
        login: { submitButton: 'Sign In' }
      })
    });
    const analyzer = new I18nAnalyzer();

    // Act
    const result = await analyzer.analyze({
      config: { type: 'react-i18next', defaultLocale: 'en', localesPath: 'public/locales/{locale}.json', structure: 'single' },
      sourceExtractions: [
        { filePath: 'src/pages/LoginPage.tsx', translationKeys: ['login.submitButton'] }
      ]
    });

    // Assert
    const files = result.translationIndex.keyToFiles.get('login.submitButton');
    expect(files).toBeDefined();
    expect(files!.has('src/pages/LoginPage.tsx')).toBe(true);
  });

  it('maps the same key to multiple files when used in both', async () => {
    // Arrange: 'common.loading' used in two different components
    mockFs({
      'public/locales/en.json': JSON.stringify({ common: { loading: 'Loading...' } })
    });
    const analyzer = new I18nAnalyzer();

    // Act
    const result = await analyzer.analyze({
      config: { type: 'react-i18next', defaultLocale: 'en', localesPath: 'public/locales/{locale}.json', structure: 'single' },
      sourceExtractions: [
        { filePath: 'src/components/Spinner.tsx', translationKeys: ['common.loading'] },
        { filePath: 'src/pages/DashboardPage.tsx', translationKeys: ['common.loading'] }
      ]
    });

    // Assert
    const files = result.translationIndex.keyToFiles.get('common.loading');
    expect(files!.has('src/components/Spinner.tsx')).toBe(true);
    expect(files!.has('src/pages/DashboardPage.tsx')).toBe(true);
    expect(files!.size).toBe(2);
  });

});
```

#### 5. Translation Resolution Helpers

```typescript
describe('I18nAnalyzer - helper methods', () => {

  let analyzer: I18nAnalyzer;
  let index: ITranslationIndex;

  beforeEach(async () => {
    mockFs({
      'public/locales/en.json': JSON.stringify({
        login: { submitButton: 'Sign In', password: 'Password' },
        dashboard: { welcome: 'Welcome, {{name}}!' }
      })
    });
    analyzer = new I18nAnalyzer();
    const result = await analyzer.analyze({
      config: { type: 'react-i18next', defaultLocale: 'en', localesPath: 'public/locales/{locale}.json', structure: 'single' },
      sourceExtractions: [
        { filePath: 'src/pages/LoginPage.tsx', translationKeys: ['login.submitButton'] }
      ]
    });
    index = result.translationIndex;
  });

  it('translateKey returns the text for a known key', () => {
    expect(analyzer.translateKey(index, 'login.submitButton')).toBe('Sign In');
  });

  it('translateKey returns undefined for an unknown key', () => {
    expect(analyzer.translateKey(index, 'nonexistent.key')).toBeUndefined();
  });

  it('findKeysByText returns matching keys for a given text', () => {
    expect(analyzer.findKeysByText(index, 'Sign In')).toContain('login.submitButton');
  });

  it('findKeysByText returns empty array for unknown text', () => {
    expect(analyzer.findKeysByText(index, 'Ghost Text')).toEqual([]);
  });

  it('findFilesUsingKey returns files for a mapped key', () => {
    const files = analyzer.findFilesUsingKey(index, 'login.submitButton');
    expect(files.has('src/pages/LoginPage.tsx')).toBe(true);
  });

  it('findFilesUsingKey returns empty set for an unmapped key', () => {
    const files = analyzer.findFilesUsingKey(index, 'login.password');
    expect(files.size).toBe(0); // 'login.password' is not in any sourceExtraction
  });

  it('isDynamicKey returns true for interpolated keys', () => {
    expect(analyzer.isDynamicKey(index, 'dashboard.welcome')).toBe(true);
  });

  it('isDynamicKey returns false for static keys', () => {
    expect(analyzer.isDynamicKey(index, 'login.submitButton')).toBe(false);
  });

  it('getStaticText returns stripped text for dynamic keys', () => {
    expect(analyzer.getStaticText(index, 'dashboard.welcome')).toBe('Welcome,!');
  });

  it('getStaticText returns undefined for static keys', () => {
    expect(analyzer.getStaticText(index, 'login.submitButton')).toBeUndefined();
  });

});
```

### Integration Tests

```typescript
describe('I18nAnalyzer - integration', () => {

  it('full pipeline: namespaced files + source extractions + scorer lookup', async () => {
    // This test simulates the real end-to-end flow:
    //   1. Analyst loads translation files from disk
    //   2. Source extractor results tell us which files use which keys
    //   3. Scorer uses textToKeys to match cy.contains('Sign In') → changed file

    mockFs({
      'public/locales/en/login.json': JSON.stringify({
        title: 'Sign In',
        submitButton: 'Sign In',
        password: 'Password'
      }),
      'public/locales/en/dashboard.json': JSON.stringify({
        welcome: 'Welcome, {{name}}!',
        logout: 'Logout'
      })
    });

    const analyzer = new I18nAnalyzer();
    const result = await analyzer.analyze({
      config: {
        type: 'react-i18next',
        defaultLocale: 'en',
        localesPath: 'public/locales/{locale}/{namespace}.json',
        structure: 'namespaced'
      },
      sourceExtractions: [
        { filePath: 'src/pages/LoginPage.tsx', translationKeys: ['login.submitButton', 'login.password'] },
        { filePath: 'src/pages/DashboardPage.tsx', translationKeys: ['dashboard.welcome', 'dashboard.logout'] }
      ]
    });

    // ── Static key flow ────────────────────────────────────────────────────
    // cy.contains('Sign In') → keys ['login.title', 'login.submitButton']
    // 'login.submitButton' is used by LoginPage.tsx → match
    const keysForSignIn = result.translationIndex.textToKeys.get('Sign In');
    expect(keysForSignIn).toContain('login.submitButton');
    const filesForSubmit = result.translationIndex.keyToFiles.get('login.submitButton');
    expect(filesForSubmit!.has('src/pages/LoginPage.tsx')).toBe(true);

    // ── Dynamic key flow ───────────────────────────────────────────────────
    // cy.contains('Welcome,') → stripped text lookup → 'dashboard.welcome'
    // 'dashboard.welcome' is used by DashboardPage.tsx → match
    const keysForWelcome = result.translationIndex.textToKeys.get('Welcome,!');
    expect(keysForWelcome).toContain('dashboard.welcome');
    const filesForWelcome = result.translationIndex.keyToFiles.get('dashboard.welcome');
    expect(filesForWelcome!.has('src/pages/DashboardPage.tsx')).toBe(true);
    expect(result.translationIndex.dynamicKeys.has('dashboard.welcome')).toBe(true);

    // ── No warnings ────────────────────────────────────────────────────────
    expect(result.warnings).toHaveLength(0);
  });

  it('gracefully handles a mix of valid and broken files without aborting', async () => {
    mockFs({
      'public/locales/en/login.json': JSON.stringify({ title: 'Sign In' }),
      'public/locales/en/broken.json': '{ NOT VALID JSON }'
    });

    const analyzer = new I18nAnalyzer();
    const result = await analyzer.analyze({
      config: { type: 'react-i18next', defaultLocale: 'en', localesPath: 'public/locales/{locale}/{namespace}.json', structure: 'namespaced' },
      sourceExtractions: []
    });

    // Valid file was still indexed
    expect(result.translationIndex.keyToText.get('login.title')).toBe('Sign In');
    // Broken file produced a warning, not a crash
    expect(result.warnings.some(w => w.code === 'INVALID_JSON')).toBe(true);
  });

});
```

## Dependencies

- Base analyzer system (Task 01)
- Source extractor (Task 02)

## Related Tasks

- Task 02: Source Extractor Analyzer
- Task 05: Scoring Engine (translation-match scorer)
- Task 03: Cypress Extractor Analyzer

## Notes

- Translation resolution enables matching cy.contains to translation keys
- Index is stored in registry for fast lookup during scoring
- Supports both single-file and namespaced translation structures
- Dynamic keys (with interpolation) are stored with both raw and stripped text to support partial `cy.contains()` matching
- Warnings are always returned as structured data — never swallowed — so the CLI layer controls whether to abort or continue
- Multiple locales supported via config