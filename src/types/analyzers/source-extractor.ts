import { IRouteDef } from '@/types/analyzers/route-analyzer';

/**
 * The output structure for the SourceExtractor analyzer.
 * Represents the semantic information extracted from a source file.
 */
export interface ISourceExtractionResult {
  filePath: string;
  exports: string[];
  imports: string[];
  classes: string[];
  functions: string[];
  interfaces: string[];
  keywords: string[];

  // JSX mining
  selectors: ISourceSelector[];
  jsxTextContent: string[];
  translationKeys: string[];
  routesDefined: IRouteDef[];

  // Redux usage
  reduxUsage: {
    selectorsUsed: string[];
    actionsDispatched: string[];
    slicesDefined: string[];
  };

  // String literals shaped like Redux action types: UPPER_SNAKE or "slice/UPPER_SNAKE".
  actionTypeStrings: string[];

  // `export const FOO = 'some-literal'` where the literal matches the
  // action-type regex. Used by registry-builder to resolve imported
  // identifiers back to their underlying action-type string.
  actionTypeConstExports: Record<string, string>;

  // Named imports: each entry is { name, module }. Lets the registry
  // resolve `import { FOO } from './types'` to the literal FOO holds in
  // the target module's actionTypeConstExports.
  importedIdentifiers: Array<{ name: string; module: string }>;
}

/** Represents a selector attribute (e.g. data-testid="button") */
export interface ISourceSelector {
  attr: string;
  value: string;
}
