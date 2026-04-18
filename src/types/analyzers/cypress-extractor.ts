import { ESelectorAttr } from '@/utils/enums';

/**
 * Represents the result of a Cypress extraction.
 * Contains information about the extracted test structure, visited routes, selectors, and custom commands.
 */
export interface ICypressExtractionResult {
  filePath: string;
  imports?: string[];

  // Test structure
  describeBlocks: string[];
  itBlocks: string[];

  // Cypress commands
  visitedRoutes: string[];
  selectors: ICypressSelector[];
  containsText: string[];
  interceptedAPIs: IAPIIntercept[];
  urlAssertions: IURLAssertion[];

  // Custom commands
  customCommandsUsed: string[];

  // Redux action-type strings referenced by the test (string literals,
  // keyMirror keys, *Types.X property accesses). Lets the action-type scorer
  // bridge tests to changed Redux files when they share an action contract.
  actionTypeStrings: string[];

  // `import { X } from 'module'` in the spec. Used to resolve identifiers
  // used in the spec back to literal action-type strings defined in the
  // imported module.
  importedIdentifiers: Array<{ name: string; module: string }>;
}

export interface ICypressSelector {
  type: ESelectorAttr;
  value: string;
  raw: string;
}

export interface IAPIIntercept {
  method: string;
  urlPattern: string;
}

export interface IURLAssertion {
  operator: string;
  expectedValue: string;
}
