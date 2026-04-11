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
