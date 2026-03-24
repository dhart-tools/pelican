# Task 07: i18n Analyzer

## Overview

Create an analyzer that resolves translation keys to their translated text and builds a mapping between keys, translations, and source files. This analyzer bridges the gap between `t('key')` in source and `cy.contains('text')` in tests.

## Objectives

1. Load and parse translation files (JSON)
2. Build bi-directional key↔text mapping
3. Map translation keys to source files using them
4. Provide translation resolution for scoring
5. Support multiple i18n libraries (react-i18next, react-intl, custom)

## Core Types

```typescript
export interface II18nExtractionResult {
  translationIndex: ITranslationIndex;
  locale: string;
}

export interface ITranslationIndex {
  keyToText: Map<string, string>;
  textToKeys: Map<string, string[]>;
  keyToFiles: Map<string, Set<string>>;
}

export interface II18nLibraryConfig {
  type: 'react-i18next' | 'react-intl' | 'custom';
  defaultLocale: string;
  localesPath: string;
  structure: 'single' | 'namespaced';
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
  II18nLibraryConfig
} from '../core/types';
import { ISourceExtractionResult } from '../core/types';

export class I18nAnalyzer extends BaseAnalyzer {
  constructor() {
    super({
      name: 'i18n',
      version: '1.0.0',
      description: 'Builds translation index and resolves keys to text',
      dependencies: ['source-extractor']
    });
  }

  async analyze(input: {
    config: II18nLibraryConfig;
    sourceExtractions: ISourceExtractionResult[];
  }): Promise<II18nExtractionResult> {
    const { config, sourceExtractions } = input;

    // Load translation files
    const translationIndex = await this.loadTranslationFiles(config);

    // Map translation keys to source files
    this.mapKeysToFiles(translationIndex, sourceExtractions);

    return {
      translationIndex,
      locale: config.defaultLocale
    };
  }

  private async loadTranslationFiles(config: II18nLibraryConfig): Promise<ITranslationIndex> {
    const index: ITranslationIndex = {
      keyToText: new Map(),
      textToKeys: new Map(),
      keyToFiles: new Map()
    };

    const locale = config.defaultLocale;
    const localesPath = config.localesPath;

    if (config.structure === 'single') {
      // Single file: locales/en.json
      const filePath = localesPath.replace('{locale}', locale);
      const translations = await this.loadJSONFile(filePath);
      this.addToIndex(index, translations, '');
    } else {
      // Namespaced: locales/en/common.json, locales/en/login.json
      const dir = path.dirname(localesPath).replace('{locale}', locale);
      const pattern = path.basename(localesPath);

      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);

        for (const file of files) {
          if (file.endsWith('.json')) {
            const filePath = path.join(dir, file);
            const translations = await this.loadJSONFile(filePath);
            const namespace = file.replace('.json', '');
            this.addToIndex(index, translations, namespace);
          }
        }
      }
    }

    return index;
  }

  private async loadJSONFile(filePath: string): Promise<any> {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.warn(`Failed to load translation file ${filePath}:`, error);
      return {};
    }
  }

  private addToIndex(index: ITranslationIndex, translations: any, namespace: string): void {
    this.traverseTranslations(index, translations, namespace);
  }

  private traverseTranslations(
    index: ITranslationIndex,
    obj: any,
    prefix: string
  ): void {
    for (const key in obj) {
      const value = obj[key];
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (typeof value === 'string') {
        // Add to keyToText
        index.keyToText.set(fullKey, value);

        // Add to textToKeys (handle duplicates)
        const keys = index.textToKeys.get(value) || [];
        if (!keys.includes(fullKey)) {
          keys.push(fullKey);
          index.textToKeys.set(value, keys);
        }
      } else if (typeof value === 'object' && value !== null) {
        // Recurse into nested object
        this.traverseTranslations(index, value, fullKey);
      }
    }
  }

  private mapKeysToFiles(
    index: ITranslationIndex,
    sourceExtractions: ISourceExtractionResult[]
  ): void {
    for (const extraction of sourceExtractions) {
      const filePath = extraction.filePath;
      const translationKeys = extraction.translationKeys || [];

      for (const key of translationKeys) {
        const files = index.keyToFiles.get(key) || new Set();
        files.add(filePath);
        index.keyToFiles.set(key, files);
      }
    }
  }

  // Helper method to look up translation text from key
  translateKey(index: ITranslationIndex, key: string): string | undefined {
    return index.keyToText.get(key);
  }

  // Helper method to look up translation keys from text
  findKeysByText(index: ITranslationIndex, text: string): string[] {
    return index.textToKeys.get(text) || [];
  }

  // Helper method to find files using a translation key
  findFilesUsingKey(index: ITranslationIndex, key: string): Set<string> {
    return index.keyToFiles.get(key) || new Set();
  }
}
```

### 2. Update Types File

**File:** `src/core/types.ts` (Add to existing)

```typescript
// Add these types

export interface II18nExtractionResult {
  translationIndex: ITranslationIndex;
  locale: string;
}

export interface ITranslationIndex {
  keyToText: Map<string, string>;
  textToKeys: Map<string, string[]>;
  keyToFiles: Map<string, Set<string>>;
}

export interface II18nLibraryConfig {
  type: 'react-i18next' | 'react-intl' | 'custom';
  defaultLocale: string;
  localesPath: string;
  structure: 'single' | 'namespaced';
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
    localesPath: 'public/locales/{locale}/translation.json',
    structure: 'namespaced'
  },
  sourceExtractions: [
    // List of source extraction results from SourceExtractor
  ]
});

console.log(result.translationIndex.keyToText);
// Map(3) {
//   'login.submitButton' => 'Sign In',
//   'login.password' => 'Password',
//   'common.loading' => 'Loading...'
// }

// Helper methods
const text = analyzer.translateKey(result.translationIndex, 'login.submitButton');
console.log(text); // 'Sign In'

const keys = analyzer.findKeysByText(result.translationIndex, 'Sign In');
console.log(keys); // ['login.submitButton']

const files = analyzer.findFilesUsingKey(result.translationIndex, 'login.submitButton');
console.log(files); // Set(['src/pages/LoginPage.tsx'])
```

## Example Translation Files

### Single File Structure

```json
// public/locales/en/translation.json
{
  "login": {
    "title": "Sign In",
    "submitButton": "Sign In",
    "password": "Password"
  },
  "dashboard": {
    "welcome": "Welcome",
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

// public/locales/en/dashboard.json
{
  "welcome": "Welcome",
  "logout": "Logout"
}
```

## Testing Strategy

### Unit Tests

1. **Translation Loading**
   - Test single file loading
   - Test namespaced loading
   - Test nested object traversal
   - Test error handling

2. **Index Building**
   - Test keyToText mapping
   - Test textToKeys mapping
   - Test keyToFiles mapping

3. **Translation Resolution**
   - Test translateKey
   - Test findKeysByText
   - Test findFilesUsingKey

### Integration Tests

1. Test with real translation files
2. Test with source file extractions
3. Test different i18n libraries

## Scoring Integration

The i18n analyzer integrates with the scoring engine via the Translation Match Scorer:

```typescript
export class TranslationMatchScorer extends BaseScorer {
  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, changedFile: changedEntry, registry } = context;

    // Get translation index
    const translationIndex = registry.getTranslationIndex();

    // Get text contains from test
    const containsText = testEntry.cypress?.containsText || [];

    // Get translation keys from changed file
    const translationKeys = changedEntry.translationKeys || [];

    // Match: cy.contains('Sign In') → 'Sign In' → ['login.submitButton'] → changed file uses 'login.submitButton'
    for (const text of containsText) {
      const keys = translationIndex.textToKeys.get(text) || [];

      for (const key of keys) {
        if (translationKeys.includes(key)) {
          return [
            this.createSignal(
              true,
              `Test contains "${text}" which maps to "${key}" used in source file`,
              { changedFile, testFile, text, key }
            )
          ];
        }
      }
    }

    return [this.createSignal(false, 'No translation matches')];
  }
}
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
- Multiple locales supported via config