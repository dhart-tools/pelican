import * as path from 'path';

import { IImportGraphExtractionResult, ISpecRegistry } from '@v2/types/analyzers';
import { EImportExportType } from '@v2/utils/enums';
import { ImportGraphAnalyzer } from '@v2/core/analyzers/import-graph-analyzer/import-graph-analyzer';

describe('ImportGraphAnalyzer', () => {
  let analyzer: ImportGraphAnalyzer;

  beforeEach(() => {
    analyzer = new ImportGraphAnalyzer();
  });

  /**
   * @description Verifies extraction of standard static imports (default, named, and side-effect).
   */
  test('extract(): should extract static imports and exports', async () => {
    const filePath = path.resolve('/project/src/components/Button.tsx');
    const sourceCode = `
      import React from 'react';
      import { Icon } from './Icon';
      import './styles.css';

      export const Button = () => <button />;
      export default Button;
    `;

    const result = await analyzer.extract({ filePath, sourceCode });

    expect(result.imports).toContainEqual(
      expect.objectContaining({
        source: 'react',
        type: EImportExportType.DEFAULT,
        specifier: 'React',
      }),
    );

    expect(result.imports).toContainEqual(
      expect.objectContaining({
        source: './Icon',
        type: EImportExportType.NAMED,
        specifier: 'Icon',
      }),
    );

    expect(result.imports).toContainEqual(
      expect.objectContaining({
        source: './styles.css',
        type: EImportExportType.NAMED,
      }),
    );

    expect(result.exports).toContainEqual(
      expect.objectContaining({
        name: 'Button',
        type: EImportExportType.NAMED,
      }),
    );

    expect(result.exports).toContainEqual(
      expect.objectContaining({
        name: 'default',
        type: EImportExportType.DEFAULT,
      }),
    );
  });

  /**
   * @description Ensures re-exports (barrels) are correctly captured with their resolved sources.
   */
  test('extract(): should capture re-exports for barrel files', async () => {
    const filePath = path.resolve('/project/src/components/index.ts');
    const sourceCode = `
      export { Button } from './Button';
      export * from './Modal';
      export type { Theme } from './types';
    `;

    const result = await analyzer.extract({ filePath, sourceCode });

    expect(result.exports).toContainEqual(
      expect.objectContaining({
        name: 'Button',
        source: './Button',
        resolvedSource: path.resolve('/project/src/components/Button'),
      }),
    );

    expect(result.exports).toContainEqual(
      expect.objectContaining({
        name: '*',
        source: './Modal',
        resolvedSource: path.resolve('/project/src/components/Modal'),
      }),
    );

    expect(result.exports).toContainEqual(
      expect.objectContaining({
        name: 'Theme',
        type: EImportExportType.TYPE,
      }),
    );
  });

  /**
   * @description Validates that type-only imports and exports are correctly flagged.
   */
  test('extract(): should identify type-only imports', async () => {
    const filePath = path.resolve('/project/src/utils.ts');
    const sourceCode = `
      import type { User } from './types';
      import { type Config, run } from './config';
    `;

    const result = await analyzer.extract({ filePath, sourceCode });

    const typeImport = result.imports.find((i) => i.source === './types');
    const configImport = result.imports.find((i) => i.specifier === 'Config');
    const runImport = result.imports.find((i) => i.specifier === 'run');

    expect(typeImport?.isTypeOnly).toBe(true);
    expect(configImport?.isTypeOnly).toBe(true);
    expect(runImport?.isTypeOnly).toBe(false);
  });

  /**
   * @description Verifies detection of dynamic imports and CommonJS require calls.
   */
  test('extract(): should handle dynamic imports and require calls', async () => {
    const filePath = path.resolve('/project/src/App.tsx');
    const sourceCode = `
      const LazyComp = React.lazy(() => import('./LazyComp'));
      const config = require('./config.json');
    `;

    const result = await analyzer.extract({ filePath, sourceCode });

    expect(result.imports).toContainEqual(
      expect.objectContaining({
        source: './LazyComp',
        isDynamic: true,
      }),
    );

    expect(result.imports).toContainEqual(
      expect.objectContaining({
        source: './config.json',
        type: EImportExportType.DEFAULT,
      }),
    );
  });

  /**
   * @description Validates full graph construction, including barrel expansion.
   */
  test('buildImportGraph(): should construct bidirectional graph and resolve barrels', () => {
    const extractions: IImportGraphExtractionResult[] = [
      {
        filePath: path.resolve('/project/src/index.ts'),
        imports: [
          {
            source: './components',
            resolvedPath: path.resolve('/project/src/components/index.ts'),
            type: EImportExportType.NAMED,
            specifier: 'Button',
          },
        ],
        exports: [],
      },
      {
        filePath: path.resolve('/project/src/components/index.ts'),
        imports: [],
        exports: [
          {
            name: 'Button',
            source: './Button',
            resolvedSource: path.resolve('/project/src/components/Button.tsx'),
            type: EImportExportType.NAMED,
          },
        ],
      },
      {
        filePath: path.resolve('/project/src/components/Button.tsx'),
        imports: [],
        exports: [{ name: 'Button', type: EImportExportType.NAMED }],
      },
    ];

    const graph = analyzer.buildImportGraph(extractions);

    // index.ts -> Button.tsx (resolved via barrel index.ts)
    expect(graph.dependencies.get(path.resolve('/project/src/index.ts'))).toContain(
      path.resolve('/project/src/components/Button.tsx'),
    );

    // Button.tsx is depended on by index.ts
    expect(graph.dependents.get(path.resolve('/project/src/components/Button.tsx'))).toContain(
      path.resolve('/project/src/index.ts'),
    );
  });

  /**
   * @description Ensures type-only imports are excluded from the runtime dependency graph.
   */
  test('buildImportGraph(): should ignore type-only imports in dependency tracking', () => {
    const extractions: IImportGraphExtractionResult[] = [
      {
        filePath: path.resolve('/project/src/main.ts'),
        imports: [
          {
            source: './runtime',
            resolvedPath: path.resolve('/project/src/runtime.ts'),
            type: EImportExportType.DEFAULT,
            isTypeOnly: false,
          },
          {
            source: './types',
            resolvedPath: path.resolve('/project/src/types.ts'),
            type: EImportExportType.TYPE,
            isTypeOnly: true,
          },
        ],
        exports: [],
      },
    ];

    const graph = analyzer.buildImportGraph(extractions);
    const deps = graph.dependencies.get(path.resolve('/project/src/main.ts'));

    expect(deps).toContain(path.resolve('/project/src/runtime.ts'));
    expect(deps).not.toContain(path.resolve('/project/src/types.ts'));
  });

  /**
   * @description Verifies transitive dependent resolution (climbing up the graph).
   */
  test('getTransitiveDependents(): should find all files affected by a change', () => {
    const graph = {
      dependencies: new Map(),
      dependents: new Map([
        [path.resolve('/src/Leaf.ts'), new Set([path.resolve('/src/Middle.ts')])],
        [path.resolve('/src/Middle.ts'), new Set([path.resolve('/src/Root.ts')])],
      ]),
    };

    const affected = analyzer.getTransitiveDependents(graph, path.resolve('/src/Leaf.ts'));

    expect(affected.get(path.resolve('/src/Middle.ts'))).toBe(1);
    expect(affected.get(path.resolve('/src/Root.ts'))).toBe(2);
  });

  /**
   * @description Validates ranking of spec suggestions based on graph distance.
   */
  test('suggestSpecFiles(): should rank spec files by proximity', () => {
    const graph = {
      dependencies: new Map(),
      dependents: new Map([
        [path.resolve('/src/Button.tsx'), new Set([path.resolve('/src/Form.tsx')])],
      ]),
    };

    const specRegistry: ISpecRegistry = new Map([
      [path.resolve('/src/Button.tsx'), new Set([path.resolve('/cypress/button.cy.ts')])],
      [path.resolve('/src/Form.tsx'), new Set([path.resolve('/cypress/form.cy.ts')])],
    ]);

    const suggestions = analyzer.suggestSpecFiles(
      graph,
      path.resolve('/src/Button.tsx'),
      specRegistry,
    );

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].specFile).toBe(path.resolve('/cypress/button.cy.ts'));
    expect(suggestions[0].depth).toBe(0);
    expect(suggestions[1].specFile).toBe(path.resolve('/cypress/form.cy.ts'));
    expect(suggestions[1].depth).toBe(1);
  });
});
