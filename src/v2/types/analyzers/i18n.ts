/**
 * Result of the i18n analysis.
 */
export interface II18nExtractionResult {
  translationIndex: ITranslationIndex;
  locale: string;
  warnings: II18nWarning[];
}

/**
 * Index of translations and their mappings to source files.
 */
export interface ITranslationIndex {
  keyToText: Map<string, string>; // 'login.submitButton' → 'Sign In'
  textToKeys: Map<string, string[]>; // 'Sign In' → ['login.submitButton']
  keyToFiles: Map<string, Set<string>>; // 'login.submitButton' → Set(['src/pages/LoginPage.tsx'])
  dynamicKeys: Set<string>; // keys whose values contain interpolation placeholders
  keyToStaticText: Map<string, string>; // stripped version of dynamic values for partial matching
}

/**
 * Configuration for the i18n library structure.
 */
export interface II18nLibraryConfig {
  type: "react-i18next" | "react-intl" | "custom";
  defaultLocale: string;
  localesPath: string; // e.g., 'public/locales/{locale}/{namespace}.json'
  structure: "single" | "namespaced";
}

/**
 * Structured warning codes for i18n-related issues.
 */
export type I18nWarningCode =
  | "FILE_NOT_FOUND" // file path does not exist on disk
  | "INVALID_JSON" // file exists but JSON.parse failed
  | "EMPTY_TRANSLATION_FILE" // file parsed successfully but has zero keys
  | "LOCALE_DIR_MISSING"; // namespaced mode: the locale directory itself is missing

/**
 * Represents a structured warning from the i18n analyzer.
 */
export interface II18nWarning {
  code: I18nWarningCode;
  filePath: string; // absolute or relative path that caused the warning
  message: string; // human-readable description
}
