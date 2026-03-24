import { SourceExtractorAnalyzer } from "./source-extractor";

describe("SourceExtractorAnalyzer", () => {
  const extractor = new SourceExtractorAnalyzer();

  test("extract(): should process a complete file successfully", async () => {
    const sourceCode = `
      import { t } from 'i18n';
      export function App() { return <div data-testid="test" />; }
    `;
    const result = await extractor.extract({ filePath: "app.ts", sourceCode });
    expect(result.filePath).toBe("app.ts");
    expect(result.functions).toContain("App");
  });

  test("extractImport() and extractExport(): should handle named and default imports/exports", async () => {
    const sourceCode = `
      import { a, b as c } from 'module';
      import d from 'default-module';
      export { e };
    `;
    const result = await extractor.extract({ filePath: "imports.ts", sourceCode });
    expect(result.imports).toContain("module");
    expect(result.imports).toContain("default-module");
    expect(result.exports).toContain("a");
    expect(result.exports).toContain("c");
    expect(result.exports).toContain("d");
    expect(result.exports).toContain("e");
  });

  test("extractJSXAttributes(): should extract specific data attributes", async () => {
    const sourceCode = `
      export const Comp = () => (
        <div data-testid="t1" data-cy="c1" id="id1" aria-label="a1" random="ignored" />
      );
    `;
    const result = await extractor.extract({ filePath: "jsx.tsx", sourceCode });
    expect(result.selectors.length).toBe(4);
    expect(result.selectors.some((s) => s.attr === "data-testid" && s.value === "t1")).toBe(true);
    expect(result.selectors.some((s) => s.attr === "data-cy" && s.value === "c1")).toBe(true);
    expect(result.selectors.some((s) => s.attr === "id" && s.value === "id1")).toBe(true);
    expect(result.selectors.some((s) => s.attr === "aria-label" && s.value === "a1")).toBe(true);
  });

  test("extractFunctionCalls(): should extract i18n and Redux patterns", async () => {
    const sourceCode = `
      t('hello');
      useSelector((state) => state.val);
      dispatch(action());
      createSlice({ name: 'mySlice' });
    `;
    const result = await extractor.extract({ filePath: "calls.ts", sourceCode });
    expect(result.translationKeys).toContain("hello");
    expect(result.reduxUsage.selectorsUsed.some((s) => s.includes("state.val"))).toBe(true);
    expect(result.reduxUsage.actionsDispatched).toContain("action");
    expect(result.reduxUsage.slicesDefined).toContain("mySlice");
  });

  test("extractRouteFromJSX(): should extract Route components", async () => {
    const sourceCode = `
      import { Route } from 'react-router-dom';
      const routes = () => <Route path="/home" element={<Home />} />;
    `;
    const result = await extractor.extract({ filePath: "routes.tsx", sourceCode });
    expect(result.routesDefined.length).toBe(1);
    expect(result.routesDefined[0].path).toBe("/home");
    expect(result.routesDefined[0].component).toBe("Home");
  });
});
