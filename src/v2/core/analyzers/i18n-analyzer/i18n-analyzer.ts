import * as fs from "fs";
import * as path from "path";
import { BaseAnalyzer } from "@v2/core/analyzers/base";
import {
  II18nExtractionResult,
  ITranslationIndex,
  II18nLibraryConfig,
  II18nWarning,
  ISourceExtractionResult,
} from "@v2/types/analyzers";
import { EAnalyzerName } from "@v2/utils/enums";

/**
 * i18nAnalyzer: Resolves translation keys to their translated text and builds a mapping.
 *
 * This analyzer bridges the gap between t('key') in source and cy.contains('text') in tests.
 * Since it needs to load multiple translation files and depends on source extractions,
 * it performs a global analysis rather than a per-file extraction.
 */
export class I18nAnalyzer extends BaseAnalyzer<
  { config: II18nLibraryConfig; sourceExtractions: ISourceExtractionResult[] },
  II18nExtractionResult
> {
  name = EAnalyzerName.I18N_ANALYZER;
  version = "1.0.0";
  dependencies = [EAnalyzerName.SOURCE_EXTRACTOR];

  // ─── Interpolation patterns ───────────────────────────────────────────────
  //
  // Pattern 1: {{name}}       — react-i18next (double curly braces)
  // Pattern 2: {count}        — react-intl / JS template literals (single braces)
  // Pattern 3: %(key)s        — Python-style (used by some custom setups)
  //
  private readonly INTERPOLATION_PATTERNS: RegExp[] = [
    /\{\{.*?\}\}/g, // react-i18next:  {{name}}, {{count}}
    /\{[^}]+\}/g, // react-intl:     {name},   {count}
    /%\([^)]+\)s/g, // python-style:   %(key)s
  ];

  /**
   * Orchestrates the i18n analysis process.
   *
   * @param input Contains the i18n configuration and all source code extractions.
   * @returns A promise resolving to the global i18n extraction result.
   */
  async extract(input: {
    config: II18nLibraryConfig;
    sourceExtractions: ISourceExtractionResult[];
  }): Promise<II18nExtractionResult> {
    const { config, sourceExtractions } = input;
    const warnings: II18nWarning[] = [];

    const translationIndex = await this.loadTranslationFiles(config, warnings);
    this.mapKeysToFiles(translationIndex, sourceExtractions);

    return {
      translationIndex,
      locale: config.defaultLocale,
      warnings,
    };
  }

  /**
   * Required by BaseAnalyzer, but indexing for i18n is typically handled globally.
   */
  index(output: II18nExtractionResult): void {
    console.log("Indexing i18n Analysis for locale:", output.locale);
  }

  // ─── Translation File Loading ─────────────────────────────────────────────

  private async loadTranslationFiles(
    config: II18nLibraryConfig,
    warnings: II18nWarning[],
  ): Promise<ITranslationIndex> {
    const index: ITranslationIndex = {
      keyToText: new Map(),
      textToKeys: new Map(),
      keyToFiles: new Map(),
      dynamicKeys: new Set(),
      keyToStaticText: new Map(),
    };

    const locale = config.defaultLocale;

    if (config.structure === "single") {
      const filePath = config.localesPath.replace("{locale}", locale);
      const translations = await this.loadJSONFile(filePath, warnings);
      this.addToIndex(index, translations, "");
    } else {
      const dir = path.dirname(config.localesPath).replace("{locale}", locale);

      if (!fs.existsSync(dir)) {
        warnings.push({
          code: "LOCALE_DIR_MISSING",
          filePath: dir,
          message: `Locale directory not found: ${dir}. Check that 'localesPath' and 'defaultLocale' are correct in your config.`,
        });
        return index;
      }

      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const filePath = path.join(dir, file);
          const translations = await this.loadJSONFile(filePath, warnings);
          const namespace = file.replace(".json", "");
          this.addToIndex(index, translations, namespace);
        }
      }
    }

    return index;
  }

  /**
   * Loads and parses a single translation JSON file with structured warning surfacing.
   */
  private async loadJSONFile(
    filePath: string,
    warnings: II18nWarning[],
  ): Promise<Record<string, unknown>> {
    let content: string;

    try {
      content = await fs.promises.readFile(filePath, "utf-8");
    } catch (error: any) {
      warnings.push({
        code: "FILE_NOT_FOUND",
        filePath,
        message: `Could not read translation file: ${filePath} — ${error.message}`,
      });
      return {};
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch (error: any) {
      warnings.push({
        code: "INVALID_JSON",
        filePath,
        message: `Translation file contains invalid JSON: ${filePath} — ${error.message}`,
      });
      return {};
    }

    if (Object.keys(parsed).length === 0) {
      warnings.push({
        code: "EMPTY_TRANSLATION_FILE",
        filePath,
        message: `Translation file loaded but contains no keys: ${filePath}. This may indicate a wrong path.`,
      });
    }

    return parsed;
  }

  // ─── Index Building ───────────────────────────────────────────────────────

  private addToIndex(
    index: ITranslationIndex,
    translations: Record<string, unknown>,
    namespace: string,
  ): void {
    this.traverseTranslations(index, translations, namespace);
  }

  /**
   * Recursively walks a translation object to flatten keys and identify interpolation.
   */
  private traverseTranslations(
    index: ITranslationIndex,
    obj: Record<string, unknown>,
    prefix: string,
  ): void {
    for (const key in obj) {
      const value = obj[key];
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (typeof value === "string") {
        index.keyToText.set(fullKey, value);

        const existingKeys = index.textToKeys.get(value) || [];
        if (!existingKeys.includes(fullKey)) {
          existingKeys.push(fullKey);
          index.textToKeys.set(value, existingKeys);
        }

        if (this.hasInterpolation(value)) {
          index.dynamicKeys.add(fullKey);
          const staticText = this.stripInterpolation(value);

          if (staticText.length > 0) {
            index.keyToStaticText.set(fullKey, staticText);
            const staticKeys = index.textToKeys.get(staticText) || [];
            if (!staticKeys.includes(fullKey)) {
              staticKeys.push(fullKey);
              index.textToKeys.set(staticText, staticKeys);
            }
          }
        }
      } else if (typeof value === "object" && value !== null) {
        this.traverseTranslations(index, value as Record<string, unknown>, fullKey);
      }
    }
  }

  // ─── Interpolation Helpers ────────────────────────────────────────────────

  private hasInterpolation(value: string): boolean {
    return this.INTERPOLATION_PATTERNS.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(value);
    });
  }

  private stripInterpolation(value: string): string {
    let stripped = value;
    for (const pattern of this.INTERPOLATION_PATTERNS) {
      pattern.lastIndex = 0;
      stripped = stripped.replace(pattern, "");
    }
    return stripped.replace(/\s+/g, " ").trim();
  }

  // ─── Key → File Mapping ───────────────────────────────────────────────────

  private mapKeysToFiles(
    index: ITranslationIndex,
    sourceExtractions: ISourceExtractionResult[],
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
