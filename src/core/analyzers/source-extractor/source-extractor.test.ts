import { SourceExtractorAnalyzer } from '@/core/analyzers/source-extractor/source-extractor';

describe('SourceExtractorAnalyzer', () => {
  const extractor = new SourceExtractorAnalyzer();

  /**
   * @description Verifies the fundamental extraction capabilities of the SourceExtractorAnalyzer.
   *
   * @example
   * // Input source code:
   * import { t } from 'i18n';
   * export function App() { return <div data-testid="test" />; }
   *
   * @expected Expects the analyzer to capture the file path and identify 'App' as an exported function.
   */
  test('extract(): should process a complete file successfully', async () => {
    const sourceCode = `
      import { t } from 'i18n';
      export function App() { return <div data-testid="test" />; }
    `;
    const result = await extractor.extract({ filePath: 'app.ts', sourceCode });
    expect(result.filePath).toBe('app.ts');
    expect(result.functions).toContain('App');
  });

  /**
   * @description Validates the extraction of different import and export patterns.
   *
   * @example
   * // Input source code:
   * import { a, b as c } from 'module';
   * import d from 'default-module';
   * export { e };
   *
   * @expected Expects 'module' and 'default-module' to be in imports.
   * @expected Expects 'a', 'c', 'd', and 'e' to be in exports.
   */
  test('extractImport() and extractExport(): should handle named and default imports/exports', async () => {
    const sourceCode = `
      import { a, b as c } from 'module';
      import d from 'default-module';
      export { e };
    `;
    const result = await extractor.extract({ filePath: 'imports.ts', sourceCode });
    expect(result.imports).toContain('module');
    expect(result.imports).toContain('default-module');
    expect(result.exports).toContain('a');
    expect(result.exports).toContain('c');
    expect(result.exports).toContain('d');
    expect(result.exports).toContain('e');
  });

  /**
   * @description Ensures the analyzer correctly parses JSX attributes used for testing (selectors).
   *
   * @example
   * // Input source code:
   * <div data-testid="t1" data-cy="c1" id="id1" aria-label="a1" random="ignored" />
   *
   * @expected Expects all four supported selectors (data-testid, data-cy, id, aria-label) to be extracted, ignoring 'random'.
   */
  test('extractJSXAttributes(): should extract specific data attributes', async () => {
    const sourceCode = `
      export const Comp = () => (
        <div data-testid="t1" data-cy="c1" id="id1" aria-label="a1" random="ignored" />
      );
    `;
    const result = await extractor.extract({ filePath: 'jsx.tsx', sourceCode });
    expect(result.selectors.length).toBe(4);
    expect(result.selectors.some((s) => s.attr === 'data-testid' && s.value === 't1')).toBe(true);
    expect(result.selectors.some((s) => s.attr === 'data-cy' && s.value === 'c1')).toBe(true);
    expect(result.selectors.some((s) => s.attr === 'id' && s.value === 'id1')).toBe(true);
    expect(result.selectors.some((s) => s.attr === 'aria-label' && s.value === 'a1')).toBe(true);
  });

  /**
   * @description Tests the identification of specific function calls commonly used for translation and Redux state management.
   *
   * @example
   * // Input source code:
   * t('hello');
   * useSelector((state) => state.val);
   * dispatch(action());
   * createSlice({ name: 'mySlice' });
   *
   * @expected Expects 'hello' in translationKeys, the selector string in selectorsUsed, 'action' in actionsDispatched, and 'mySlice' in slicesDefined.
   */
  test('extractFunctionCalls(): should extract i18n and Redux patterns', async () => {
    const sourceCode = `
      t('hello');
      useSelector((state) => state.val);
      dispatch(action());
      createSlice({ name: 'mySlice' });
    `;
    const result = await extractor.extract({ filePath: 'calls.ts', sourceCode });
    expect(result.translationKeys).toContain('hello');
    expect(result.reduxUsage.selectorsUsed.some((s) => s.includes('state.val'))).toBe(true);
    expect(result.reduxUsage.actionsDispatched).toContain('action');
    expect(result.reduxUsage.slicesDefined).toContain('mySlice');
  });

  /**
   * @description Checks if React Router 'Route' components are correctly identified and their path/component extracted.
   *
   * @example
   * // Input source code:
   * <Route path="/home" element={<Home />} />;
   *
   * @expected Expects the path '/home' and component 'Home' to be captured in routesDefined.
   */
  test('extractRouteFromJSX(): should extract Route components', async () => {
    const sourceCode = `
      import { Route } from 'react-router-dom';
      const routes = () => <Route path="/home" element={<Home />} />;
    `;
    const result = await extractor.extract({ filePath: 'routes.tsx', sourceCode });
    expect(result.routesDefined.length).toBe(1);
    expect(result.routesDefined[0].path).toBe('/home');
    expect(result.routesDefined[0].component).toBe('Home');
  });
});
