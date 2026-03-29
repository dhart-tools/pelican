import { EReduxRole } from '@v2/utils/enums';

/**
 * The structure of a Redux Chain, linking a slice to its related files and consumers.
 */
export interface IReduxChain {
  sliceName: string;
  files: {
    actions?: string;
    reducer?: string;
    selectors?: string;
    sagas?: string[];
    types?: string;
    slice?: string;
  };
  actionTypes: string[];
  selectorNames: string[];
  consumers: string[]; // Files that import from the slice's selectors
}

/**
 * The extraction result for a single file during Redux analysis.
 */
export interface IReduxExtractionResult {
  filePath: string;
  role: EReduxRole;
  sliceName?: string;
  actionTypes: string[];
  selectors: SelectorMetadata[];
  sagas: SagaMetadata[];
  importedFiles: string[]; // Used for consumer detection in Pass 2
}

/** Metadata for a Redux Selector */
export interface SelectorMetadata {
  name: string;
  usesRootState: boolean;
  selectorDependencies: string[];
}

/** Metadata for a Redux Saga */
export interface SagaMetadata {
  name: string;
  actionsTaken: string[];
  actionsPut: string[];
}
