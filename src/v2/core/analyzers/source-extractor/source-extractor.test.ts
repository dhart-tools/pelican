import { describe, test } from "node:test";
import assert from "node:assert";
import { SourceExtractorAnalyzer } from "./source-extractor";

describe("SourceExtractorAnalyzer", () => {
  const extractor = new SourceExtractorAnalyzer();

  test("extract(): should process a complete file successfully", async () => {
    const sourceCode = `
      import { t } from 'i18n';
      export function App() { return <div data-testid="test" />; }
    `;
    const result = await extractor.extract({ filePath: "app.ts", sourceCode });
    assert.strictEqual(result.filePath, "app.ts");
    assert.ok(result.functions.includes("App"));
  });

  test("extractImport() and extractExport(): should handle named and default imports/exports", async () => {
    const sourceCode = `
      import { a, b as c } from 'module';
      import d from 'default-module';
      export { e };
    `;
    const result = await extractor.extract({ filePath: "imports.ts", sourceCode });
    assert.ok(result.imports.includes("module"));
    assert.ok(result.imports.includes("default-module"));
    assert.ok(result.exports.includes("a"));
    assert.ok(result.exports.includes("c"));
    assert.ok(result.exports.includes("d"));
    assert.ok(result.exports.includes("e"));
  });

  test("extractJSXAttributes(): should extract specific data attributes", async () => {
    const sourceCode = `
      export const Comp = () => (
        <div data-testid="t1" data-cy="c1" id="id1" aria-label="a1" random="ignored" />
      );
    `;
    const result = await extractor.extract({ filePath: "jsx.tsx", sourceCode });
    assert.strictEqual(result.selectors.length, 4);
    assert.ok(result.selectors.some((s) => s.attr === "data-testid" && s.value === "t1"));
    assert.ok(result.selectors.some((s) => s.attr === "data-cy" && s.value === "c1"));
    assert.ok(result.selectors.some((s) => s.attr === "id" && s.value === "id1"));
    assert.ok(result.selectors.some((s) => s.attr === "aria-label" && s.value === "a1"));
  });

  test("extractFunctionCalls(): should extract i18n and Redux patterns", async () => {
    const sourceCode = `
      t('hello');
      useSelector((state) => state.val);
      dispatch(action());
      createSlice({ name: 'mySlice' });
    `;
    const result = await extractor.extract({ filePath: "calls.ts", sourceCode });
    assert.ok(result.translationKeys.includes("hello"));
    assert.ok(result.reduxUsage.selectorsUsed.some((s) => s.includes("state.val")));
    assert.ok(result.reduxUsage.actionsDispatched.includes("action"));
    assert.ok(result.reduxUsage.slicesDefined.includes("mySlice"));
  });

  test("extractRouteFromJSX(): should extract Route components", async () => {
    const sourceCode = `
      import { Route } from 'react-router-dom';
      const routes = () => <Route path="/home" element={<Home />} />;
    `;
    const result = await extractor.extract({ filePath: "routes.tsx", sourceCode });
    assert.strictEqual(result.routesDefined.length, 1);
    assert.strictEqual(result.routesDefined[0].path, "/home");
    assert.strictEqual(result.routesDefined[0].component, "Home");
  });
});
