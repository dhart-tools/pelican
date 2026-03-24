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
}

/** Represents a selector attribute (e.g. data-testid="button") */
export interface ISourceSelector {
  attr: string;
  value: string;
}

/** Represents a route definition */
export interface IRouteDef {
  path: string;
  component: string;
}
