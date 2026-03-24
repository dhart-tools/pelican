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
  importedFiles: string[]; // FIX 1: added to support consumer detection
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
      sagas: [],
      importedFiles: [] // FIX 1: initialize importedFiles
    };

    this.visitNode(sourceFile, result, filePath);

    return result;
  }

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
        consumers: []
      };

      for (const extraction of group) {
        this.addToChain(chain, extraction);
      }

      chains.set(sliceName, chain);
    }

    // --- Pass 2 (FIX 1): Find consumers via import scanning ---
    // A file is a consumer of a slice if it imports from that slice's
    // selectors file. importedFiles is populated by the source extractor.
    for (const extraction of extractions) {
      if (extraction.role === 'types') continue;

      for (const [, chain] of chains) {
        if (!chain.files.selectors) continue;

        const importsFromSelectors = extraction.importedFiles?.includes(
          chain.files.selectors
        );

        if (importsFromSelectors && !chain.consumers.includes(extraction.filePath)) {
          chain.consumers.push(extraction.filePath);
        }
      }
    }

    return chains;
  }

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
      if (!chain.files.sagas) {
        chain.files.sagas = [];
      }
      if (!chain.files.sagas.includes(extraction.filePath)) {
        chain.files.sagas.push(extraction.filePath);
      }
    }

    // Role handles the base slice and reducer assignments
    if (extraction.role === 'slice') {
      chain.files.slice = extraction.filePath;
      chain.files.reducer = extraction.filePath;
      chain.files.actions = chain.files.actions ?? extraction.filePath;
    } else if (extraction.role === 'reducer') {
      chain.files.reducer = extraction.filePath;
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

    // FIX 1: collect imports as we visit nodes
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier)) {
        result.importedFiles.push(moduleSpecifier.text);
      }
    }

    // Detect createSlice / createAction / createSelector calls
    if (ts.isCallExpression(node)) {
      this.detectCreateSlice(node, result);
      this.detectCreateAction(node, result);
      this.detectCreateSelector(node, result);
    }

    // Detect function declarations (selectors, reducers, sagas)
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
      if (ts.isFunctionDeclaration(node) && node.asteriskToken) {
        this.detectGeneratorSaga(node, result);
      } else {
        this.detectSelectorOrReducer(node, result);
      }
    }

    // Detect class methods (redux-thunk actions)
    if (ts.isMethodDeclaration(node)) {
      this.detectThunkAction(node, result);
    }

    // Recursively visit children
    ts.forEachChild(node, (child) => this.visitNode(child, result, filePath));
  }

  // FIX 3: shared helper — handles both `createSlice(...)` and `rtk.createSlice(...)`
  private getCalledFunctionName(node: ts.CallExpression): string | null {
    const expr = node.expression;
    if (ts.isIdentifier(expr)) return expr.text;
    if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
    return null;
  }

  private detectCreateSlice(node: ts.CallExpression, result: IReduxExtractionResult): void {
    // FIX 3: use helper instead of assuming PropertyAccessExpression
    if (this.getCalledFunctionName(node) !== 'createSlice') return;

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

  private detectCreateAction(node: ts.CallExpression, result: IReduxExtractionResult): void {
    // FIX 3: use helper instead of assuming PropertyAccessExpression
    if (this.getCalledFunctionName(node) !== 'createAction') return;

    result.role = 'actions';

    if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
      result.actionTypes.push(node.arguments[0].text);
    }
  }

  private detectCreateSelector(node: ts.CallExpression, result: IReduxExtractionResult): void {
    // FIX 3: use helper instead of assuming PropertyAccessExpression
    if (this.getCalledFunctionName(node) !== 'createSelector') return;

    result.role = 'selectors';

    const selectorName = this.inferSelectorName(node);
    const selector: SelectorMetadata = {
      name: selectorName,
      usesRootState: this.checkUsesRootState(node),
      selectorDependencies: this.extractSelectorDependencies(node)
    };

    result.selectors.push(selector);
  }

  private detectGeneratorSaga(node: ts.FunctionDeclaration, result: IReduxExtractionResult): void {
    result.role = 'sagas';

    const sagaMetadata: SagaMetadata = {
      name: node.name?.getText() || 'anonymous',
      actionsTaken: [],
      actionsPut: []
    };

    this.analyzeSagaBody(node, sagaMetadata);
    result.sagas.push(sagaMetadata);
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

          // takeEvery(action, worker) / takeLatest(action, worker)
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
    // Matches src/store/user/, src/state/user/, src/features/user/, src/redux/user/
    const match = filePath.match(/(?:store|state|features|redux)\/([^\/]+)\//);
    return match ? match[1] : undefined;
  }

  private inferSelectorName(node: ts.CallExpression): string {
    let current: ts.Node = node;
    while (current.parent) {
      if (ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name)) {
        return current.parent.name.text;
      }
      if (ts.isPropertyAssignment(current.parent) && ts.isIdentifier(current.parent.name)) {
        return current.parent.name.text;
      }
      current = current.parent;
    }
    return 'anonymous-selector';
  }

  private checkUsesRootState(node: ts.CallExpression): boolean {
    return false; // Implementation would analyze AST
  }

  private extractSelectorDependencies(node: ts.CallExpression): string[] {
    return []; // Implementation would extract input selectors
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
  importedFiles: string[]; // FIX 1: added for consumer detection
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

## What Changed and Why

### FIX 1 — Consumer Detection

**Problem:** `chain.consumers` was always `[]` because nothing ever populated it.

**Solution:** Two changes working together:

1. `IReduxExtractionResult` now has an `importedFiles: string[]` field. During `visitNode`, every `ImportDeclaration` is scanned and its module specifier is collected into this array. The source extractor (Task 02) may already resolve these to absolute paths — if so, use those resolved paths here instead of the raw specifier string.

2. `buildChains` now has a **second pass** after the slice groups are built. It iterates every extraction and checks whether its `importedFiles` includes the known selectors file for any chain. If it does, that file is a consumer of that slice and gets pushed into `chain.consumers`.

**Note:** For this to work reliably, the paths in `importedFiles` must match the paths stored in `chain.files.selectors`. If your source extractor resolves imports to absolute paths, make sure `chain.files.selectors` is also stored as an absolute path.

---

### FIX 2 — Slice Role Conflict

**Problem:** A `createSlice` file is simultaneously the actions file and the reducer file, but `addToChain` only filed it under `files.slice` and ignored the other two slots.

**Solution:** The `slice` case in `addToChain` now also sets `files.reducer` unconditionally, and sets `files.actions` if nothing else has claimed it yet. This means the scoring engine can check `files.reducer` and `files.actions` on any chain and get a valid path regardless of whether the project uses separate files or a single slice file.

---

### FIX 3 — Wrong AST Check for createSlice / createAction / createSelector

**Problem:** All three detectors checked `ts.isPropertyAccessExpression(expr)` before reading `.name.text`. But when these functions are used as named imports (`import { createSlice } from '@reduxjs/toolkit'`), the call expression is a plain `Identifier` — not a `PropertyAccessExpression`. So the detectors silently never fired.

**Solution:** A shared helper `getCalledFunctionName` handles both cases:
- `createSlice(...)` → expression is `Identifier`, returns `expr.text`
- `rtk.createSlice(...)` → expression is `PropertyAccessExpression`, returns `expr.name.text`

All three detectors now call this helper and return early if the name doesn't match, making them both correct and easier to read.

---

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

// Analyze a component that consumes the slice
const componentResult = await analyzer.analyze({
  filePath: 'src/containers/UserProfile.tsx',
  sourceCode: fs.readFileSync('src/containers/UserProfile.tsx', 'utf-8')
});

// Build chains — consumer detection runs automatically in Pass 2
const extractions = [actionsResult, reducerResult, componentResult];
const chains = await analyzer.buildChains(extractions);

const userChain = chains.get('user');
console.log(userChain);
// {
//   sliceName: 'user',
//   files: {
//     actions: 'src/store/user/actions.ts',  ← populated even for slice files (FIX 2)
//     reducer: 'src/store/user/reducer.ts',
//     selectors: 'src/store/user/selectors.ts',
//     sagas: ['src/store/user/sagas.ts']
//   },
//   actionTypes: ['user/login', 'user/logout', 'user/loginSuccess'],
//   selectorNames: ['selectUser', 'selectIsLoading'],
//   consumers: ['src/containers/UserProfile.tsx']  ← now populated (FIX 1)
// }
```

## Testing Strategy

### Unit Tests

1. **Slice Detection**
   - Test `createSlice(...)` as named import (FIX 3)
   - Test `rtk.createSlice(...)` as namespace import (FIX 3)
   - Test ActionType extraction from reducers object
   - Test slice name inference from file path across varied directory structures (`features/`, `state/`, `redux/`, `store/`)

2. **Reducer Detection**
   - Test `(state, action)` pattern
   - Test switch statement detection

3. **Selector Detection**
   - Test RootState parameter
   - Test `createSelector(...)` as named import (FIX 3)
   - Test selector dependency extraction
   - Test inferring selector name from variable declarations and property assignments

4. **Saga Detection**
   - Test standard generator functions are detected as sagas
   - Test take/takeEvery/takeLatest
   - Test put action extraction

5. **Consumer Detection (FIX 1)**
   - Test that a component importing from a selectors file appears in `chain.consumers`
   - Test that a component NOT importing from selectors does not appear
   - Test deduplication (component imported by two chains only appears once per chain)

6. **Role Conflict & Multi-Role Files (FIX 2)**
   - Test that a `createSlice` file populates both `files.reducer` and `files.actions`
   - Test that a file with both actions and selectors preserves all roles without overwriting

### 1. Tests for `inferSelectorName` (AST Parent Walking)
We need to ensure that the analyzer correctly traverses up the AST to find the variable or property name assigned to `createSelector`.

```typescript
// Proposed Test in: redux-chain-analyzer.spec.ts
it('should infer selector name from variable declaration', async () => {
  const sourceCode = `
    import { createSelector } from '@reduxjs/toolkit';
    export const selectCurrentUser = createSelector(
      (state) => state.user,
      (user) => user.profile
    );
  `;
  const result = await analyzer.analyze({ filePath: 'src/features/user/selectors.ts', sourceCode });
  
  expect(result.selectors).toHaveLength(1);
  expect(result.selectors[0].name).toBe('selectCurrentUser'); // Previously returned 'anonymous-selector'
});

it('should infer selector name from property assignment', async () => {
  const sourceCode = `
    const selectors = {
      selectIsLoading: createSelector((state) => state.user, (user) => user.loading)
    };
  `;
  const result = await analyzer.analyze({ filePath: 'src/features/user/selectors.ts', sourceCode });
  
  expect(result.selectors[0].name).toBe('selectIsLoading');
});
```

### 2. Tests for Generator Saga Detection
We need to verify that standard generator functions are correctly identified as sagas, which was previously failing due to the AST node type mismatch.

```typescript
// Proposed Test in: redux-chain-analyzer.spec.ts
it('should detect generator functions as sagas', async () => {
  const sourceCode = `
    import { takeLatest, put } from 'redux-saga/effects';
    
    export function* fetchUserSaga() {
      yield put({ type: 'user/fetchSuccess' });
    }
    
    export default function* rootSaga() {
      yield takeLatest('user/fetchRequest', fetchUserSaga);
    }
  `;
  const result = await analyzer.analyze({ filePath: 'src/features/user/sagas.ts', sourceCode });
  
  expect(result.sagas).toHaveLength(2);
  expect(result.sagas.find(s => s.name === 'fetchUserSaga')).toBeDefined();
  expect(result.sagas.find(s => s.name === 'rootSaga')).toBeDefined();
});
```

### 3. Tests for Multi-Role Files (Role Overwrite Fix)
We need to prove that a file containing both actions and a reducer (or selectors) doesn't lose its metadata when built into a chain.

```typescript
// Proposed Test in: redux-chain-analyzer.spec.ts
it('should preserve all roles when a file exports multiple Redux constructs', async () => {
  const sourceCode = `
    import { createAction, createSelector } from '@reduxjs/toolkit';
    
    export const loginAction = createAction('auth/login');
    
    export const selectAuth = createSelector((state) => state.auth, auth => auth);
    
    export default function authReducer(state = {}, action) {
      return state;
    }
  `;
  const extraction = await analyzer.analyze({ filePath: 'src/features/auth/index.ts', sourceCode });
  const chains = await analyzer.buildChains([extraction]);
  const authChain = chains.get('auth');

  // Ensure nothing was overwritten by a single 'role' string
  expect(authChain?.files.actions).toBe('src/features/auth/index.ts');
  expect(authChain?.files.reducer).toBe('src/features/auth/index.ts');
  expect(authChain?.files.selectors).toBe('src/features/auth/index.ts');
  expect(authChain?.actionTypes).toContain('auth/login');
  expect(authChain?.selectorNames).toContain('selectAuth');
});
```

### 4. Tests for Broadened `extractSliceNameFromPath` Regex
We need to guarantee that slice names are extracted correctly across different standard architectural patterns (`features/`, `state/`, `redux/`, `store/`).

```typescript
// Proposed Test in: redux-chain-analyzer.spec.ts
it('should correctly extract slice name from various directory conventions', async () => {
  const paths = [
    'src/store/cart/slice.ts',
    'src/features/cart/index.ts',
    'src/state/cart/reducers.ts',
    'src/redux/cart/actions.ts'
  ];

  for (const filePath of paths) {
    const result = await analyzer.analyze({ filePath, sourceCode: '' });
    expect(result.sliceName).toBe('cart'); // Previously failed for 3 out of 4
  }
});
```

### 5. Tests for Component ↔ Test Mapping (Scoring Engine)
We need to mock the `Registry` to prove that if a Cypress test uses a selector (e.g., `data-testid="login-btn"`) that is defined in a component, and that component is a consumer of the `auth` Redux chain, the scorer correctly issues a Redux Chain match signal.

```typescript
// Proposed Test in: redux-chain-scorer.spec.ts
it('should yield a match if a Cypress test uses a selector from a Redux consumer', () => {
  const scorer = new ReduxChainScorer();
  
  // 1. Mock the Redux Chain with a known consumer
  const mockChains = new Map();
  mockChains.set('auth', {
    sliceName: 'auth',
    files: { reducer: 'src/features/auth/slice.ts' },
    consumers: ['src/components/LoginForm.tsx'] // The Component
  });

  // 2. Mock the Selector Index mapping the DOM selector to the Component
  const mockSelectorIndex = new Map();
  mockSelectorIndex.set('login-btn', new Set(['src/components/LoginForm.tsx']));

  // 3. Mock the Registry
  const mockRegistry = {
    getReduxChains: () => mockChains,
    getSelectorIndex: () => mockSelectorIndex,
    getFile: (path) => {
      if (path === 'cypress/e2e/login.cy.ts') {
        return {
          path,
          cypress: { selectors: [{ type: 'testid', value: 'login-btn' }] }
        };
      }
      return {};
    }
  };

  const context = {
    registry: mockRegistry,
    changedFile: { path: 'src/features/auth/slice.ts' }, // Changed the reducer
    testFile: { path: 'cypress/e2e/login.cy.ts' } // Running the E2E test
  };

  const signals = scorer.evaluate(
    'src/features/auth/slice.ts', 
    'cypress/e2e/login.cy.ts', 
    context
  );

  expect(signals).toHaveLength(1);
  expect(signals[0].matched).toBe(true);
  expect(signals[0].reason).toContain('E2E test uses selector \'login-btn\'');
});

### Integration Tests

1. Test chain building from a real store with separate files
2. Test chain building from a store using `createSlice` (single file per slice)
3. Test consumer detection end-to-end with a component file
4. Test chain propagation logic in scoring engine (including Cypress E2E component mapping via DOM selectors)

## Dependencies

- `typescript` (peer dependency)
- Base analyzer system (Task 01)
- Source Extractor (Task 02) — provides `importedFiles` for consumer detection

## Related Tasks

- Task 01: Base Analyzer System
- Task 02: Source Extractor Analyzer
- Task 05: Scoring Engine (redux-chain scorer)

## Notes

- Redux chains enable semantic impact propagation beyond the import graph
- Sagas link actions to side effects and potentially to routes
- Consumer detection links chains to UI components — this is the critical last hop to test files
- For consumer detection to work, `importedFiles` paths must match the format used in `chain.files.selectors` (both absolute or both relative)
- The scoring engine should check `files.slice` alongside `files.reducer` and `files.actions` when determining if a changed file belongs to a chain
