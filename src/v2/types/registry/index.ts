import {
  ITranslationIndex,
  IReduxChain,
  ISourceSelector,
  IRouteDef,
  ICypressSelector,
  IAPIIntercept,
  IURLAssertion,
  IImportGraph,
} from '@v2/types/analyzers';

export interface IFileEntry {
  name: string;
  type: 'source' | 'test';
  path: string;

  // From Source Extraction
  exports: string[];
  imports: string[];
  classes: string[];
  functions: string[];
  interfaces: string[];
  keywords: string[];
  selectors?: ISourceSelector[];
  jsxTextContent?: string[];
  translationKeys?: string[];
  routesDefined?: IRouteDef[];
  reduxUsage?: {
    selectorsUsed: string[];
    actionsDispatched: string[];
    slicesDefined: string[];
  };

  // From Cypress Extraction
  cypress?: {
    visitedRoutes: string[];
    selectors: ICypressSelector[];
    containsText: string[];
    interceptedAPIs: IAPIIntercept[];
    urlAssertions: IURLAssertion[];
    customCommandsUsed: string[];
    describeBlocks: string[];
    itBlocks: string[];
  };
}


export interface IRegistry {
  readonly files: Map<string, IFileEntry>;
  readonly importGraph: IImportGraph;

  // Indexes
  getSelectorIndex(): Map<string, Set<string>>;
  setSelectorIndex(index: Map<string, Set<string>>): void;

  getRouteMap(): Map<string, string>;
  setRouteMap(map: Map<string, string>): void;

  getTranslationIndex(): ITranslationIndex;
  setTranslationIndex(index: ITranslationIndex): void;

  getReduxChains(): Map<string, IReduxChain>;
  setReduxChains(chains: Map<string, IReduxChain>): void;

  getTextIndex(): Map<string, Set<string>>;
  setTextIndex(index: Map<string, Set<string>>): void;

  // Query methods
  getFile(path: string): IFileEntry | undefined;
  getFilesByType(type: 'source' | 'test'): IFileEntry[];
  getDependencies(filePath: string): Set<string>;
  getDependents(filePath: string): Set<string>;

  // Build methods
  buildFromFileEntries(entries: IFileEntry[]): void;
  buildImportGraph(entries: IFileEntry[]): void;
  buildSelectorIndex(entries: IFileEntry[]): void;
  buildRouteMap(entries: IFileEntry[]): void;
  buildTextIndex(entries: IFileEntry[]): void;
  addOrUpdateFile(entry: IFileEntry): void;

  // Persistence
  serialize(): string;
  deserialize(data: string): void;
}
