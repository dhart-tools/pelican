import * as path from 'path';

import { ICypressExtractionResult, ISourceExtractionResult } from '@v2/types';
import { IFileEntry } from '@v2/types/registry';

import { normalizePath } from './path-utils';

/**
 * Converts the result of a source file extraction into a standard Registry file entry.
 */
export function convertSourceExtractionToFileEntry(
  result: ISourceExtractionResult,
  filePath: string,
  projectRoot: string,
): IFileEntry {
  return {
    name: path.basename(filePath),
    type: 'source',
    path: normalizePath(filePath, projectRoot),
    exports: result.exports ?? [],
    imports: (result.imports ?? []).map((p: string) => normalizePath(p, projectRoot)),
    classes: result.classes ?? [],
    functions: result.functions ?? [],
    interfaces: result.interfaces ?? [],
    keywords: result.keywords ?? [],
    selectors: result.selectors,
    jsxTextContent: result.jsxTextContent,
    translationKeys: result.translationKeys,
    routesDefined: result.routesDefined,
    reduxUsage: result.reduxUsage,
  };
}

/**
 * Converts the result of a Cypress spec extraction into a standard Registry file entry.
 */
export function convertCypressExtractionToFileEntry(
  result: ICypressExtractionResult,
  filePath: string,
  projectRoot: string,
): IFileEntry {
  return {
    name: path.basename(filePath),
    type: 'test',
    path: normalizePath(filePath, projectRoot),
    exports: [],
    imports: (result.imports ?? []).map((p: string) => normalizePath(p, projectRoot)),
    classes: [],
    functions: [],
    interfaces: [],
    keywords: [],
    cypress: {
      visitedRoutes: result.visitedRoutes,
      selectors: result.selectors,
      containsText: result.containsText,
      interceptedAPIs: result.interceptedAPIs,
      urlAssertions: result.urlAssertions,
      customCommandsUsed: result.customCommandsUsed,
      describeBlocks: result.describeBlocks,
      itBlocks: result.itBlocks,
    },
  };
}
