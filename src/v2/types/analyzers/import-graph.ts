import { EImportExportType } from '@v2/utils/enums';
import { IAliasResolverConfig } from '@v2/types/analyzers/route-analyzer';

/**
 * Import Metadata - represents a single import in a source file.
 */
export interface IImportMetadata {
  /** The raw import source string, e.g. './components/Button' or '@/pages/Home' */
  source: string;
  /** The fully resolved absolute path to the imported file */
  resolvedPath: string;
  /** The type of import */
  type: EImportExportType;
  /** The imported name/alias (if applicable) */
  specifier?: string;
  /** Whether this is a dynamic import, e.g. import('./file') */
  isDynamic?: boolean;
  /** Whether it is a type-only import, which has no runtime dependency */
  isTypeOnly?: boolean;
}

/**
 * Export Metadata - represents a single export in a source file.
 */
export interface IExportMetadata {
  /** The name of the exported item */
  name: string;
  /** The source file if this is a re-export, e.g. export { X } from './X' */
  source?: string;
  /** The fully resolved path for the re-export source */
  resolvedSource?: string;
  /** The type of export */
  type: EImportExportType;
}


/**
 * Extraction result for a single file's import and export metadata.
 */
export interface IImportGraphExtractionResult {
  /** Absolute path to the analyzed file */
  filePath: string;
  /** List of all imports found in the file */
  imports: IImportMetadata[];
  /** List of all exports found in the file */
  exports: IExportMetadata[];
}

/**
 * The final bidirectional import graph after processing all extractions.
 */
export interface IImportGraph {
  /** Keyed by file path → Set of files it directly depends on (imports) */
  dependencies: Map<string, Set<string>>;
  /** Keyed by file path → Set of files that directly depend on it (import it) */
  dependents: Map<string, Set<string>>;
}

/**
 * Barrel Index - maps a barrel file path (like index.ts) to the set of real source
 * files it re-exports.
 */
export type IBarrelIndex = Map<string, Set<string>>;

/**
 * Spec Registry - maps source file paths to the set of Cypress spec file paths
 * that test them.
 */
export type ISpecRegistry = Map<string, Set<string>>;

/**
 * Task input for the Import Graph Analyzer's extract method.
 */
export interface IImportGraphAnalyzerInput {
  /** Path to the file being analyzed */
  filePath: string;
  /** Raw source code of the file */
  sourceCode: string;
  /** User-supplied or auto-detected alias configuration */
  aliasConfig?: IAliasResolverConfig;
}
