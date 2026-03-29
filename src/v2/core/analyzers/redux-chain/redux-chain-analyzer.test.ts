import { ReduxChainAnalyzer } from '@v2/core/analyzers/redux-chain/redux-chain-analyzer';
import { IReduxExtractionResult } from '@v2/types/analyzers';
import { EReduxRole } from '@v2/utils/enums';

describe('ReduxChainAnalyzer', () => {
  const analyzer = new ReduxChainAnalyzer();

  /**
   * @description Verifies that createSlice calls are correctly identified, including slice name and action creators.
   *
   * @example
   * export const userSlice = createSlice({
   *   name: 'user',
   *   reducers: { login: (state) => {} }
   * });
   *
   * @expected Role should be 'slice', sliceName 'user', and actionTypes should include 'user/login'.
   */
  test('extract(): should detect createSlice and its actions', async () => {
    const sourceCode = `
      import { createSlice } from '@reduxjs/toolkit';
      export const userSlice = createSlice({
        name: 'user',
        initialState: {},
        reducers: {
          login: (state) => {},
          logout: (state) => {}
        }
      });
    `;
    const result = await analyzer.extract({ filePath: 'src/store/user/slice.ts', sourceCode });

    expect(result.role).toBe(EReduxRole.SLICE);
    expect(result.sliceName).toBe('user');
    expect(result.actionTypes).toContain('user/login');
    expect(result.actionTypes).toContain('user/logout');
  });

  /**
   * @description Tests the robust detection of Redux functions regardless of import style (named vs namespace).
   *
   * @example
   * import * as rtk from '@reduxjs/toolkit';
   * const slice = rtk.createSlice({ name: 'test', ... });
   *
   * @expected The analyzer should still identify the 'slice' role and the 'test' sliceName.
   */
  test('extract(): (FIX 3) should handle namespace imports like rtk.createSlice', async () => {
    const sourceCode = `
      import * as rtk from '@reduxjs/toolkit';
      const slice = rtk.createSlice({
        name: 'test',
        reducers: {}
      });
    `;
    const result = await analyzer.extract({ filePath: 'src/store/test/slice.ts', sourceCode });

    expect(result.role).toBe(EReduxRole.SLICE);
    expect(result.sliceName).toBe('test');
  });

  /**
   * @description Ensures selector names are correctly inferred from the variable they are assigned to.
   *
   * @example
   * export const selectUserName = createSelector(...)
   *
   * @expected The selector metadata should have the name 'selectUserName'.
   */
  test('extract(): should infer selector name from variable declaration', async () => {
    const sourceCode = `
      import { createSelector } from '@reduxjs/toolkit';
      export const selectUserName = createSelector(
        (state) => state.user,
        (user) => user.name
      );
    `;
    const result = await analyzer.extract({ filePath: 'src/store/user/selectors.ts', sourceCode });

    expect(result.role).toBe(EReduxRole.SELECTORS);
    expect(result.selectors[0].name).toBe('selectUserName');
  });

  /**
   * @description Verifies that generator functions are correctly identified as sagas.
   *
   * @example
   * export function* watchLogin() { ... }
   *
   * @expected Role should be 'sagas' and the function name captured.
   */
  test('extract(): should detect generator functions as sagas', async () => {
    const sourceCode = `
      import { put, takeEvery } from 'redux-saga/effects';
      export function* watchLogin() {
        yield takeEvery('LOGIN_REQUEST', function*() {
          yield put({ type: 'LOGIN_SUCCESS' });
        });
      }
    `;
    const result = await analyzer.extract({ filePath: 'src/store/auth/sagas.ts', sourceCode });

    expect(result.role).toBe(EReduxRole.SAGAS);
    expect(result.sagas[0].name).toBe('watchLogin');
  });

  /**
   * @description Validates the global reconciliation logic that builds chains from individual file extractions.
   *
   * @expected Files for the same slice should be grouped into a single IReduxChain.
   */
  test('buildChains(): should group multiple files into a coherent slice chain', async () => {
    const extractions: IReduxExtractionResult[] = [
      {
        filePath: 'src/store/user/slice.ts',
        role: EReduxRole.SLICE,
        sliceName: 'user',
        actionTypes: ['user/login'],
        selectors: [],
        sagas: [],
        importedFiles: [],
      },
      {
        filePath: 'src/store/user/selectors.ts',
        role: EReduxRole.SELECTORS,
        sliceName: 'user',
        actionTypes: [],
        selectors: [{ name: 'selectUser', usesRootState: true, selectorDependencies: [] }],
        sagas: [],
        importedFiles: [],
      },
    ];

    const chains = await analyzer.buildChains(extractions);
    const userChain = chains.get('user');

    expect(userChain).toBeDefined();
    expect(userChain?.files.slice).toBe('src/store/user/slice.ts');
    expect(userChain?.files.selectors).toBe('src/store/user/selectors.ts');
    expect(userChain?.selectorNames).toContain('selectUser');
  });

  /**
   * @description (FIX 1) Verifies that components importing from a slice's selector file are identified as consumers.
   *
   * @example
   * // Component.tsx
   * import { selectUser } from '@v2/core/analyzers/redux-chain/store/user/selectors';
   *
   * @expected The 'user' chain should list 'Component.tsx' in its consumers array.
   */
  test('buildChains(): (FIX 1) should detect consumers via import scanning', async () => {
    const extractions: IReduxExtractionResult[] = [
      {
        filePath: 'src/store/user/selectors.ts',
        role: EReduxRole.SELECTORS,
        sliceName: 'user',
        actionTypes: [],
        selectors: [{ name: 'selectUser', usesRootState: true, selectorDependencies: [] }],
        sagas: [],
        importedFiles: [],
      },
      {
        filePath: 'src/containers/Profile.tsx',
        role: EReduxRole.UNKNOWN,
        actionTypes: [],
        selectors: [],
        sagas: [],
        importedFiles: ['src/store/user/selectors.ts'], // Imports from the selectors file
      },
    ];

    const chains = await analyzer.buildChains(extractions);
    const userChain = chains.get('user');

    expect(userChain?.consumers).toContain('src/containers/Profile.tsx');
  });

  /**
   * @description (FIX 2) Ensures that a single slice file is correctly mapped as both actions and reducer.
   *
   * @expected files.actions and files.reducer should both point to the slice file path.
   */
  test("buildChains(): (FIX 2) should handle multi-role 'slice' files", async () => {
    const extraction: IReduxExtractionResult = {
      filePath: 'src/store/user/slice.ts',
      role: EReduxRole.SLICE,
      sliceName: 'user',
      actionTypes: ['user/login'],
      selectors: [],
      sagas: [],
      importedFiles: [],
    };

    const chains = await analyzer.buildChains([extraction]);
    const userChain = chains.get('user');

    expect(userChain?.files.actions).toBe('src/store/user/slice.ts');
    expect(userChain?.files.reducer).toBe('src/store/user/slice.ts');
  });

  /**
   * @description Verifies slice name inference from file paths across different project conventions.
   */
  test('extract(): should infer slice name from path conventions', async () => {
    const paths = [
      'src/store/cart/reducer.ts',
      'src/features/auth/slice.ts',
      'src/state/ui/actions.ts',
    ];

    for (const path of paths) {
      const result = await analyzer.extract({ filePath: path, sourceCode: '' });
      const expectedSlice = path.split('/')[2];
      expect(result.sliceName).toBe(expectedSlice);
    }
  });

  /**
   * @description Verifies that we can find the impacted slice from a consumer component.
   * This handles the case where changing a component might require testing the corresponding Redux logic.
   *
   * @expected Iterating over chains should allow finding the 'user' slice metadata for 'Profile.tsx'.
   */
  test('buildChains(): should allow finding slice from consumer', async () => {
    const extractions: IReduxExtractionResult[] = [
      {
        filePath: 'src/store/user/selectors.ts',
        role: EReduxRole.SELECTORS,
        sliceName: 'user',
        actionTypes: [],
        selectors: [{ name: 'selectUser', usesRootState: true, selectorDependencies: [] }],
        sagas: [],
        importedFiles: [],
      },
      {
        filePath: 'src/containers/Profile.tsx',
        role: EReduxRole.UNKNOWN,
        actionTypes: [],
        selectors: [],
        sagas: [],
        importedFiles: ['src/store/user/selectors.ts'],
      },
    ];

    const chains = await analyzer.buildChains(extractions);

    // Find which slices 'Profile.tsx' consumes
    const consumedSlices = Array.from(chains.values())
      .filter((chain) => chain.consumers.includes('src/containers/Profile.tsx'))
      .map((chain) => chain.sliceName);

    expect(consumedSlices).toContain('user');
  });
});
