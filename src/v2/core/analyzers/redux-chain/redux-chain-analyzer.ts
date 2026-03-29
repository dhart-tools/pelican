import * as ts from 'typescript';

import { BaseAnalyzer } from '@v2/core/analyzers/base';
import { IReduxChain, IReduxExtractionResult, SagaMetadata } from '@v2/types/analyzers';
import { ERedux, EFunctionCall, EReduxRole, EAnalyzerName } from '@v2/utils/enums';

/**
 * ReduxChainAnalyzer: Detects and builds Redux chains (actions -> reducer -> selectors -> sagas).
 *
 * This analyzer is unique because it works in two phases:
 * 1. Extraction: Scans single files for Redux patterns (roles, actions, selectors).
 * 2. Reconciliation: Link these files together into "Chains" based on slice names and imports.
 */
export class ReduxChainAnalyzer extends BaseAnalyzer<
  { filePath: string; sourceCode: string },
  IReduxExtractionResult
> {
  name = EAnalyzerName.REDUX_CHAIN_ANALYZER;
  version = '1.0.0';
  dependencies = [EAnalyzerName.SOURCE_EXTRACTOR]; // Needs imports from source-extractor for consumer logic

  /**
   * Phase 1: Extract Redux information from a single file.
   */
  async extract(input: { filePath: string; sourceCode: string }): Promise<IReduxExtractionResult> {
    const { filePath, sourceCode } = input;

    const sourceFile = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true);

    const result: IReduxExtractionResult = {
      filePath,
      role: EReduxRole.UNKNOWN,
      actionTypes: [],
      selectors: [],
      sagas: [],
      importedFiles: [], // FIX 1: Initialize importedFiles to track dependencies
    };

    this.visitNode(sourceFile, result, filePath);

    return result;
  }

  /**
   * Required by BaseAnalyzer, but Redux requires global reconciliation.
   * This would typically store the single file result in a registry.
   */
  index(output: IReduxExtractionResult): void {
    console.log('Indexing Redux Extraction:', output.filePath, 'as', output.role);
  }

  /**
   * Phase 2: Build global chains from all extractions.
   * This is where the "Chain" relationship (actions -> selectors -> consumers) is formed.
   */
  async buildChains(extractions: IReduxExtractionResult[]): Promise<Map<string, IReduxChain>> {
    const chains = new Map<string, IReduxChain>();

    // --- Pass 1: Group by slice name and build base chains ---
    const sliceGroups = new Map<string, IReduxExtractionResult[]>();

    for (const extraction of extractions) {
      if (extraction.sliceName) {
        const group = sliceGroups.get(extraction.sliceName) || [];
        group.push(extraction);
        sliceGroups.set(extraction.sliceName, group);
      }
    }

    for (const [sliceName, group] of sliceGroups) {
      const chain: IReduxChain = {
        sliceName,
        files: {},
        actionTypes: [],
        selectorNames: [],
        consumers: [],
      };

      for (const extraction of group) {
        this.addToChain(chain, extraction);
      }

      chains.set(sliceName, chain);
    }

    // --- Pass 2 (FIX 1): Find consumers via import scanning ---
    // We check if a file imports from a slice's selectors file.
    for (const extraction of extractions) {
      if (extraction.role === EReduxRole.TYPES) continue;

      for (const [, chain] of chains) {
        if (!chain.files.selectors) continue;

        // Does this file import from the selectors file of this slice?
        const importsFromSelectors = extraction.importedFiles?.includes(chain.files.selectors);

        if (importsFromSelectors && !chain.consumers.includes(extraction.filePath)) {
          chain.consumers.push(extraction.filePath);
        }
      }
    }

    return chains;
  }

  /**
   * Maps an extraction's data into its corresponding ReduxChain.
   */
  private addToChain(chain: IReduxChain, extraction: IReduxExtractionResult): void {
    if (extraction.actionTypes.length > 0) {
      chain.actionTypes.push(...extraction.actionTypes);
      chain.files.actions = chain.files.actions ?? extraction.filePath;
    }

    if (extraction.selectors.length > 0) {
      chain.files.selectors = chain.files.selectors ?? extraction.filePath;
      chain.selectorNames.push(...extraction.selectors.map((s) => s.name));
    }

    if (extraction.sagas.length > 0) {
      if (!chain.files.sagas) chain.files.sagas = [];
      if (!chain.files.sagas.includes(extraction.filePath)) {
        chain.files.sagas.push(extraction.filePath);
      }
    }

    // FIX 2: Handle Multi-Role Files (Slice + Reducer + Actions)
    if (extraction.role === EReduxRole.SLICE) {
      chain.files.slice = extraction.filePath;
      chain.files.reducer = extraction.filePath;
      chain.files.actions = chain.files.actions ?? extraction.filePath;
    } else if (extraction.role === EReduxRole.REDUCER) {
      chain.files.reducer = extraction.filePath;
    }
  }

  /**
   * Recursively scans AST nodes.
   */
  private visitNode(node: ts.Node, result: IReduxExtractionResult, filePath: string): void {
    // Detect slice name from file path if not already found
    if (!result.sliceName) {
      result.sliceName = this.extractSliceNameFromPath(filePath);
    }

    // FIX 1: Collect imports to detect consumers later
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier)) {
        result.importedFiles.push(moduleSpecifier.text);
      }
    }

    // Detect API Calls (createSlice, createAction, createSelector)
    if (ts.isCallExpression(node)) {
      this.detectCreateSlice(node, result);
      this.detectCreateAction(node, result);
      this.detectCreateSelector(node, result);
    }

    // Detect functions (Generators for sagas, regular for selectors/reducers)
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
      if (ts.isFunctionDeclaration(node) && node.asteriskToken) {
        this.detectGeneratorSaga(node, result);
      } else {
        this.detectSelectorOrReducer(node, result);
      }
    }

    ts.forEachChild(node, (child: ts.Node) => this.visitNode(child, result, filePath));
  }

  /**
   * FIX 3: Shared helper to handle both named and namespace imports.
   * e.g. createSlice(...) vs rtk.createSlice(...)
   */
  private getCalledFunctionName(node: ts.CallExpression): string | null {
    const expr = node.expression;
    if (ts.isIdentifier(expr)) return expr.text;
    if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
    return null;
  }

  private detectCreateSlice(node: ts.CallExpression, result: IReduxExtractionResult): void {
    if (this.getCalledFunctionName(node) !== EFunctionCall.CREATE_SLICE) return;

    result.role = EReduxRole.SLICE;

    const firstArg = node.arguments[0];
    if (ts.isObjectLiteralExpression(firstArg)) {
      for (const prop of firstArg.properties) {
        if (ts.isPropertyAssignment(prop)) {
          const propName = prop.name.getText();

          // Extract slice name: createSlice({ name: 'user', ... })
          if (propName === ERedux.NAME && ts.isStringLiteral(prop.initializer)) {
            result.sliceName = prop.initializer.text;
          }

          // Extract actions defined in the slice
          if (propName === 'reducers') {
            this.extractActionCreators(prop.initializer, result);
          }
        }
      }
    }
  }

  private detectCreateAction(node: ts.CallExpression, result: IReduxExtractionResult): void {
    if (this.getCalledFunctionName(node) !== EFunctionCall.CREATE_ACTION) return;
    result.role = EReduxRole.ACTIONS;

    if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
      result.actionTypes.push(node.arguments[0].text);
    }
  }

  private detectCreateSelector(node: ts.CallExpression, result: IReduxExtractionResult): void {
    if (this.getCalledFunctionName(node) !== EFunctionCall.CREATE_SELECTOR) return;
    result.role = EReduxRole.SELECTORS;

    result.selectors.push({
      name: this.inferSelectorName(node),
      usesRootState: true,
      selectorDependencies: [],
    });
  }

  private detectGeneratorSaga(node: ts.FunctionDeclaration, result: IReduxExtractionResult): void {
    result.role = EReduxRole.SAGAS;
    const sagaMetadata: SagaMetadata = {
      name: node.name?.getText() || 'anonymous',
      actionsTaken: [],
      actionsPut: [],
    };
    result.sagas.push(sagaMetadata);
  }

  private detectSelectorOrReducer(
    node: ts.FunctionDeclaration | ts.FunctionExpression,
    result: IReduxExtractionResult,
  ): void {
    if (node.parameters.length > 0) {
      const firstParam = node.parameters[0];

      // Simple selector check: (state: RootState) => ...
      if (firstParam.type?.getText().includes('RootState')) {
        result.role = EReduxRole.SELECTORS;
        result.selectors.push({
          name: node.name?.getText() || 'anonymous',
          usesRootState: true,
          selectorDependencies: [],
        });
        return;
      }

      // Simple reducer check: (state, action) => ...
      if (node.parameters.length >= 2) {
        result.role = EReduxRole.REDUCER;
        return;
      }
    }
  }

  private extractActionCreators(node: ts.Node, result: IReduxExtractionResult): void {
    if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
          result.actionTypes.push(`${result.sliceName}/${prop.name.text}`);
        }
      }
    }
  }

  private inferSelectorName(node: ts.CallExpression): string {
    let current: ts.Node = node;
    while (current.parent) {
      if (ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name)) {
        return current.parent.name.text;
      }
      current = current.parent;
    }
    return 'anonymous-selector';
  }

  private extractSliceNameFromPath(filePath: string): string | undefined {
    const match = filePath.match(/(?:store|state|features|redux)\/([^/]+)\//);
    return match ? match[1] : undefined;
  }
}
