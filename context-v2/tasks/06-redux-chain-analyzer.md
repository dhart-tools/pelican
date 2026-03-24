# Task 06: Redux Chain Analyzer

## Overview

Create an analyzer that detects Redux chains and their relationships. This analyzer identifies actions, reducers, selectors, sagas, and their implicit semantic connections beyond the import graph.

## Objectives

1. Detect Redux patterns in source files
2. Build Redux chains (actions → reducer → selectors → sagas)
3. Identify slice boundaries
4. Track Redux consumers (components using selectors)
5. Enable chain-based impact propagation

## Core Types

```typescript
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
  consumers: string[];
}

export interface IReduxExtractionResult {
  filePath: string;
  role: 'actions' | 'reducer' | 'selectors' | 'sagas' | 'slice' | 'types' | 'unknown';
  sliceName?: string;
  actionTypes: string[];
  selectors: SelectorMetadata[];
  sagas: SagaMetadata[];
}

export interface SelectorMetadata {
  name: string;
  usesRootState: boolean;
  selectorDependencies: string[];
}

export interface SagaMetadata {
  name: string;
  actionsTaken: string[];
  actionsPut: string[];
}
```

## Implementation

### 1. Create Redux Chain Analyzer

**File:** `src/analyzers/redux-chain-analyzer.ts`

```typescript
import * as ts from 'typescript';
import { BaseAnalyzer } from './base';
import {
  IReduxChain,
  IReduxExtractionResult,
  SelectorMetadata,
  SagaMetadata
} from '../core/types';

export class ReduxChainAnalyzer extends BaseAnalyzer {
  constructor() {
    super({
      name: 'redux-chain',
      version: '1.0.0',
      description: 'Detects and builds Redux chains from source files',
      dependencies: ['source-extractor']
    });
  }

  async analyze(input: {
    filePath: string;
    sourceCode: string;
  }): Promise<IReduxExtractionResult> {
    const { filePath, sourceCode } = input;

    const sourceFile = ts.createSourceFile(
      filePath,
      sourceCode,
      ts.ScriptTarget.Latest,
      true
    );

    const result: IReduxExtractionResult = {
      filePath,
      role: 'unknown',
      actionTypes: [],
      selectors: [],
      sagas: []
    };

    this.visitNode(sourceFile, result, filePath);

    return result;
  }

  async buildChains(extractions: IReduxExtractionResult[]): Promise<Map<string, IReduxChain>> {
    const chains = new Map<string, IReduxChain>();

    // Group by slice name
    const sliceGroups = new Map<string, IReduxExtractionResult[]>();

    for (const extraction of extractions) {
      if (extraction.sliceName) {
        const group = sliceGroups.get(extraction.sliceName) || [];
        group.push(extraction);
        sliceGroups.set(extraction.sliceName, group);
      }
    }

    // Build chains from groups
    for (const [sliceName, group] of sliceGroups) {
      const chain: IReduxChain = {
        sliceName,
        files: {},
        actionTypes: [],
        selectorNames: [],
        consumers: []
      };

      for (const extraction of group) {
        this.addToChain(chain, extraction);
      }

      chains.set(sliceName, chain);
    }

    return chains;
  }

  private addToChain(chain: IReduxChain, extraction: IReduxExtractionResult): void {
    switch (extraction.role) {
      case 'actions':
        chain.files.actions = extraction.filePath;
        chain.actionTypes.push(...extraction.actionTypes);
        break;

      case 'reducer':
        chain.files.reducer = extraction.filePath;
        break;

      case 'selectors':
        chain.files.selectors = extraction.filePath;
        chain.selectorNames.push(...extraction.selectors.map((s) => s.name));
        break;

      case 'sagas':
        if (!chain.files.sagas) {
          chain.files.sagas = [];
        }
        chain.files.sagas!.push(extraction.filePath);
        break;

      case 'slice':
        chain.files.slice = extraction.filePath;
        chain.actionTypes.push(...extraction.actionTypes);
        break;
    }
  }

  private visitNode(
    node: ts.Node,
    result: IReduxExtractionResult,
    filePath: string
  ): void {
    // Detect slice name from file path
    if (!result.sliceName) {
      result.sliceName = this.extractSliceNameFromPath(filePath);
    }

    // Detect createSlice calls
    if (ts.isCallExpression(node)) {
      this.detectCreateSlice(node, result);
      this.detectCreateAction(node, result);
      this.detectCreateSelector(node, result);
      this.detectSagas(node, result);
    }

    // Detect function declarations (selectors, reducers)
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
      this检测SelectorOrReducer(node, result);
    }

    // Detect class methods (redux-thunk actions)
    if (ts.isMethodDeclaration(node)) {
      this.detectThunkAction(node, result);
    }

    // Recursively visit children
    ts.forEachChild(node, (child) => this.visitNode(child, result, filePath));
  }

  private detectCreateSlice(node: ts.CallExpression, result: IReduxExtractionResult): void {
    const expr = node.expression;

    if (ts.isPropertyAccessExpression(expr) && expr.name.text === 'createSlice') {
      result.role = 'slice';

      const firstArg = node.arguments[0];
      if (ts.isObjectLiteralExpression(firstArg)) {
        for (const prop of firstArg.properties) {
          if (ts.isPropertyAssignment(prop)) {
            const propName = prop.name.getText();

            if (propName === 'name' && ts.isStringLiteral(prop.initializer)) {
              result.sliceName = prop.initializer.text;
            }

            if (propName === 'reducers') {
              this.extractActionCreators(prop.initializer, result);
            }
          }
        }
      }
    }
  }

  private detectCreateAction(node: ts.CallExpression, result: IReduxExtractionResult): void {
    const expr = node.expression;

    if (ts.isPropertyAccessExpression(expr) && expr.name.text === 'createAction') {
      result.role = 'actions';

      if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
        result.actionTypes.push(node.arguments[0].text);
      }
    }
  }

  private detectCreateSelector(node: ts.CallExpression, result: IReduxExtractionResult): void {
    const expr = node.expression;

    if (ts.isPropertyAccessExpression(expr) && expr.name.text === 'createSelector') {
      result.role = 'selectors';

      // Extract selector from arguments
      const selectorName = this.inferSelectorName(node);
      const selector: SelectorMetadata = {
        name: selectorName,
        usesRootState: this.checkUsesRootState(node),
        selectorDependencies: this.extractSelectorDependencies(node)
      };

      result.selectors.push(selector);
    }
  }

  private detectSagas(node: ts.CallExpression, result: IReduxExtractionResult): void {
    const expr = node.expression;

    if (ts.isIdentifier(expr)) {
      const name = expr.text;

      // Check for saga pattern imports
      if (['take', 'takeEvery', 'takeLatest', 'put', 'call', 'select'].includes(name)) {
        result.role = 'sagas';

        // Extract saga metadata
        const sagaMetadata: SagaMetadata = {
          name: this.inferSagaName(node),
          actionsTaken: this.extractActionsTaken(node),
          actionsPut: this.extractActionsPut(node)
        };

        result.sagas.push(sagaMetadata);
      }
    }

    // Generator functions are sagas
    if (ts.isFunctionDeclaration(node) && node.asteriskToken) {
      result.role = 'sagas';

      const sagaMetadata: SagaMetadata = {
        name: node.name?.getText() || 'anonymous',
        actionsTaken: [],
        actionsPut: []
      };

      // Analyze saga body for put/take calls
      this.analyzeSagaBody(node, sagaMetadata);
      result.sagas.push(sagaMetadata);
    }
  }

  private analyzeSagaBody(
    node: ts.FunctionDeclaration,
    sagaMetadata: SagaMetadata
  ): void {
    const visitSagaNode = (sagaNode: ts.Node) => {
      if (ts.isCallExpression(sagaNode)) {
        const expr = sagaNode.expression;

        if (ts.isIdentifier(expr)) {
          const name = expr.text;

          // put(action)
          if (name === 'put' && sagaNode.arguments.length > 0) {
            const action = sagaNode.arguments[0];
            if (ts.isCallExpression(action)) {
              sagaMetadata.actionsPut.push(action.expression.getText());
            }
          }

          // takeEvery(action, worker)
          if ((name === 'takeEvery' || name === 'takeLatest') && sagaNode.arguments.length > 0) {
            const pattern = sagaNode.arguments[0];
            if (ts.isStringLiteral(pattern)) {
              sagaMetadata.actionsTaken.push(pattern.text);
            }
          }
        }
      }

      ts.forEachChild(sagaNode, visitSagaNode);
    };

    if (node.body) {
      visitSagaNode(node.body);
    }
  }

  private detectSelectorOrReducer(
    node: ts.FunctionDeclaration | ts.FunctionExpression,
    result: IReduxExtractionResult
  ): void {
    // Check parameters for (state, action) pattern → reducer
    // Check parameters for (state: RootState) pattern → selector

    if (node.parameters.length > 0) {
      const firstParam = node.parameters[0];

      // Redux selector: (state: RootState) => ...
      if (this.isRootStateType(firstParam)) {
        result.role = 'selectors';

        const selector: SelectorMetadata = {
          name: node.name?.getText() || 'anonymous',
          usesRootState: true,
          selectorDependencies: []
        };

        result.selectors.push(selector);
        return;
      }

      // Redux reducer: (state, action) => ...
      if (node.parameters.length >= 2) {
        result.role = 'reducer';
        return;
      }
    }
  }

  private detectThunkAction(node: ts.MethodDeclaration, result: IReduxExtractionResult): void {
    // Thunk actions have return type of ThunkAction
    if (node.type) {
      const typeText = node.type.getText();
      if (typeText.includes('ThunkAction')) {
        result.role = 'actions';

        if (node.name) {
          result.actionTypes.push(`${result.sliceName}/${node.name.getText()}`);
        }
      }
    }
  }

  private extractActionCreators(node: ts.Node, result: IReduxExtractionResult): void {
    if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
          const actionType = `${result.sliceName}/${prop.name.text}`;
          result.actionTypes.push(actionType);
        }
      }
    }
  }

  private extractSliceNameFromPath(filePath: string): string | undefined {
    // Extract slice name from directory structure
    // e.g., src/store/user/actions.ts → 'user'
    const match = filePath.match(/store\/([^\/]+)\//);
    return match ? match[1] : undefined;
  }

  private inferSelectorName(node: ts.CallExpression): string {
    // Try to infer selector name from assignment context
    return 'anonymous-selector';
  }

  private inferSagaName(node: ts.CallExpression): string {
    return 'anonymous-saga';
  }

  private checkUsesRootState(node: ts.CallExpression): boolean {
    return false; // Implementation would analyze AST
  }

  private extractSelectorDependencies(node: ts.CallExpression): string[] {
    return []; // Implementation would extract input selectors
  }

  private extractActionsTaken(node: ts.CallExpression): string[] {
    return []; // Implementation would extract saga action patterns
  }

  private extractActionsPut(node: ts.CallExpression): string[] {
    return []; // Implementation would extract put() calls
  }

  private isRootStateType(param: ts.ParameterDeclaration): boolean {
    if (!param.type) return false;
    const typeText = param.type.getText();
    return typeText.includes('RootState') || typeText.includes('ApplicationState');
  }
}
```

### 2. Update Types File

**File:** `src/core/types.ts` (Add to existing)

```typescript
// Add these types

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
  consumers: string[];
}

export interface IReduxExtractionResult {
  filePath: string;
  role: 'actions' | 'reducer' | 'selectors' | 'sagas' | 'slice' | 'types' | 'unknown';
  sliceName?: string;
  actionTypes: string[];
  selectors: SelectorMetadata[];
  sagas: SagaMetadata[];
}

export interface SelectorMetadata {
  name: string;
  usesRootState: boolean;
  selectorDependencies: string[];
}

export interface SagaMetadata {
  name: string;
  actionsTaken: string[];
  actionsPut: string[];
}
```

## Usage Example

```typescript
import { ReduxChainAnalyzer } from './analyzers/redux-chain-analyzer';

const analyzer = new ReduxChainAnalyzer();

// Analyze individual files
const actionsResult = await analyzer.analyze({
  filePath: 'src/store/user/actions.ts',
  sourceCode: fs.readFileSync('src/store/user/actions.ts', 'utf-8')
});

const reducerResult = await analyzer.analyze({
  filePath: 'src/store/user/reducer.ts',
  sourceCode: fs.readFileSync('src/store/user/reducer.ts', 'utf-8')
});

// Build chains from multiple files
const extractions = [actionsResult, reducerResult, /* ... */];
const chains = await analyzer.buildChains(extractions);

const userChain = chains.get('user');
console.log(userChain);
// {
//   sliceName: 'user',
//   files: {
//     actions: 'src/store/user/actions.ts',
//     reducer: 'src/store/user/reducer.ts',
//     selectors: 'src/store/user/selectors.ts',
//     sagas: ['src/store/user/sagas.ts']
//   },
//   actionTypes: ['user/login', 'user/logout', 'user/setProfile'],
//   selectorNames: ['selectUser', 'selectUserName', 'selectIsLoading'],
//   consumers: ['src/containers/UserProfile.tsx']
// }
```

## Testing Strategy

### Unit Tests

1. **Slice Detection**
   - Test createSlice detection
   - Test ActionType extraction
   - Test slice name inference

2. **Reducer Detection**
   - Test (state, action) pattern
   - Test switch statement detection

3. **Selector Detection**
   - Test RootState parameter
   - Test createSelector detection
   - Test selector dependency extraction

4. **Saga Detection**
   - Test generator functions
   - Test take/takeEvery/takeLatest
   - Test put action extraction

### Integration Tests

1. Test chain building from real store
2. Test consumer detection
3. Test chain propagation logic

## Example Input/Output

### Input: User Slice

```typescript
// src/store/user/actions.ts
export const login = (credentials: Credentials) => ({
  type: 'user/login',
  payload: credentials
});

export const logout = () => ({ type: 'user/logout' });

// src/store/user/reducer.ts
const initialState = { user: null, isLoading: false };

export default function userReducer(state = initialState, action: any) {
  switch (action.type) {
    case 'user/login':
      return { ...state, isLoading: true };
    case 'user/loginSuccess':
      return { ...state, user: action.payload, isLoading: false };
    case 'user/logout':
      return { ...state, user: null };
    default:
      return state;
  }
}

// src/store/user/selectors.ts
export const selectUser = (state: RootState) => state.user.user;
export const selectIsLoading = (state: RootState) => state.user.isLoading;
```

### Output: Redux Chain

```typescript
{
  sliceName: 'user',
  files: {
    actions: 'src/store/user/actions.ts',
    reducer: 'src/store/user/reducer.ts',
    selectors: 'src/store/user/selectors.ts'
  },
  actionTypes: ['user/login', 'user/logout', 'user/loginSuccess'],
  selectorNames: ['selectUser', 'selectIsLoading'],
  consumers: []
}
```

## Dependencies

- `typescript` (peer dependency)
- Base analyzer system (Task 01)

## Related Tasks

- Task 01: Base Analyzer System
- Task 02: Source Extractor Analyzer
- Task 05: Scoring Engine (redux-chain scorer)

## Notes

- Redux chains enable semantic impact propagation beyond import graph
- Sagas link actions to side effects and potentially to routes
- Consumer detection links chains to UI components
- This analyzer is critical for proper Redux-heavy codebases