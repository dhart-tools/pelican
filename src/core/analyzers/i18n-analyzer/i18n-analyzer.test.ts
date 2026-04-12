import * as fs from 'fs';

import { I18nAnalyzer } from '@/core/analyzers/i18n-analyzer/i18n-analyzer';
import { II18nLibraryConfig } from '@/types/analyzers';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  promises: {
    readFile: jest.fn(),
  },
}));

describe('I18nAnalyzer', () => {
  let analyzer: I18nAnalyzer;

  beforeEach(() => {
    analyzer = new I18nAnalyzer();
    jest.clearAllMocks();
  });

  /**
   * @description Verifies that the analyzer can load a single translation file and build a flat key index.
   */
  test('extract(): should load a single translation file and build index', async () => {
    const config: II18nLibraryConfig = {
      type: 'react-i18next',
      defaultLocale: 'en',
      localesPath: 'public/locales/{locale}.json',
      structure: 'single',
    };

    const translations = {
      login: {
        title: 'Sign In',
        submit: 'Sign In',
      },
    };

    (fs.promises.readFile as jest.Mock).mockResolvedValue(JSON.stringify(translations));

    const result = await analyzer.extract({ config, sourceExtractions: [] });

    expect(result.translationIndex.keyToText.get('login.title')).toBe('Sign In');
    expect(result.translationIndex.keyToText.get('login.submit')).toBe('Sign In');
    expect(result.translationIndex.textToKeys.get('Sign In')).toContain('login.title');
    expect(result.translationIndex.textToKeys.get('Sign In')).toContain('login.submit');
    expect(result.warnings).toHaveLength(0);
  });

  /**
   * @description Validates namespaced structure where each file in a directory becomes a top-level key.
   */
  test('extract(): should load namespaced translation files', async () => {
    const config: II18nLibraryConfig = {
      type: 'react-i18next',
      defaultLocale: 'en',
      localesPath: 'public/locales/{locale}/{namespace}.json',
      structure: 'namespaced',
    };

    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readdirSync as jest.Mock).mockReturnValue(['login.json', 'errors.json']);
    (fs.promises.readFile as jest.Mock)
      .mockResolvedValueOnce(JSON.stringify({ title: 'Login' }))
      .mockResolvedValueOnce(JSON.stringify({ general: 'Error' }));

    const result = await analyzer.extract({ config, sourceExtractions: [] });

    expect(result.translationIndex.keyToText.get('login.title')).toBe('Login');
    expect(result.translationIndex.keyToText.get('errors.general')).toBe('Error');
    expect(result.warnings).toHaveLength(0);
  });

  /**
   * @description Ensures interpolation placeholders are correctly identified as dynamic and stripped for static matching.
   */
  test('hasInterpolation() and stripInterpolation(): should handle various placeholder formats', async () => {
    const config: II18nLibraryConfig = {
      type: 'react-i18next',
      defaultLocale: 'en',
      localesPath: 'locales/en.json',
      structure: 'single',
    };

    const translations = {
      greet: 'Hello, {{name}}!',
      count: 'Items: {count}',
      legacy: 'User %(user)s logged in',
    };

    (fs.promises.readFile as jest.Mock).mockResolvedValue(JSON.stringify(translations));

    const result = await analyzer.extract({ config, sourceExtractions: [] });

    expect(result.translationIndex.dynamicKeys.has('greet')).toBe(true);
    expect(result.translationIndex.dynamicKeys.has('count')).toBe(true);
    expect(result.translationIndex.dynamicKeys.has('legacy')).toBe(true);

    expect(result.translationIndex.keyToStaticText.get('greet')).toBe('Hello, !');
    expect(result.translationIndex.keyToStaticText.get('count')).toBe('Items:');
    expect(result.translationIndex.keyToStaticText.get('legacy')).toBe('User logged in');
  });

  /**
   * @description Verifies mapping of translation keys back to the source files that use them.
   */
  test('mapKeysToFiles(): should build bidirectional mapping between keys and source files', async () => {
    const config: II18nLibraryConfig = {
      type: 'react-i18next',
      defaultLocale: 'en',
      localesPath: 'locales/en.json',
      structure: 'single',
    };

    (fs.promises.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ test: 'Value' }));

    const sourceExtractions = [
      {
        filePath: 'src/App.tsx',
        translationKeys: ['test', 'missing'],
      } as any,
    ];

    const result = await analyzer.extract({ config, sourceExtractions });

    const files = result.translationIndex.keyToFiles.get('test');
    expect(files?.has('src/App.tsx')).toBe(true);
    expect(result.translationIndex.keyToFiles.get('missing')?.has('src/App.tsx')).toBe(true);
  });

  /**
   * @description Checks error handling for missing directories and files.
   */
  test('extract(): should handle missing locale directory', async () => {
    const config: II18nLibraryConfig = {
      type: 'react-i18next',
      defaultLocale: 'en',
      localesPath: 'locales/{locale}/{namespace}.json',
      structure: 'namespaced',
    };

    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const result = await analyzer.extract({ config, sourceExtractions: [] });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe('LOCALE_DIR_MISSING');
  });

  /**
   * @description Validates identification of empty translation files.
   */
  test('loadJSONFile(): should warn on empty JSON files', async () => {
    const config: II18nLibraryConfig = {
      type: 'react-i18next',
      defaultLocale: 'en',
      localesPath: 'locales/en.json',
      structure: 'single',
    };

    (fs.promises.readFile as jest.Mock).mockResolvedValue('{}');

    const result = await analyzer.extract({ config, sourceExtractions: [] });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe('EMPTY_TRANSLATION_FILE');
  });
});
