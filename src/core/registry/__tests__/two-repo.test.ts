import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { RegistryBuilder } from '@/core/registry/registry-builder';

/**
 * Two-repo support: source files live in one repo, Cypress specs in another,
 * jest specs colocated in the source repo. The builder must scan both roots,
 * tag each entry with its repo, and resolve a spec's cross-repo `@dm/...`
 * import (in the test repo) back to the source file (in the source repo).
 */
describe('RegistryBuilder — two separate repos', () => {
  let sourceRepo: string;
  let testRepo: string;

  const write = (root: string, rel: string, body: string) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };

  beforeAll(() => {
    sourceRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'pelican-src-'));
    testRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'pelican-test-'));

    // Source repo: a component (+ a colocated jest spec).
    write(
      sourceRepo,
      'src/dm/components/Widget.tsx',
      `export const Widget = () => <div data-test-id="WidgetRoot" />;\n`,
    );
    write(
      sourceRepo,
      'src/dm/components/Widget.test.tsx',
      `import { Widget } from './Widget';\nit('renders', () => Widget);\n`,
    );

    // Test repo: a Cypress spec importing the source via the @dm/ alias.
    write(
      testRepo,
      'cypress/e2e/widget.cy.ts',
      `import { Widget } from '@dm/components/Widget';\n` +
        `describe('Widget', () => { it('shows', () => { cy.get('[data-test-id="WidgetRoot"]'); Widget; }); });\n`,
    );
  });

  afterAll(() => {
    fs.rmSync(sourceRepo, { recursive: true, force: true });
    fs.rmSync(testRepo, { recursive: true, force: true });
  });

  const build = () =>
    new RegistryBuilder().buildFromDirectories({
      sourceDirs: ['src'],
      testPatterns: ['**/*.cy.ts', '**/*.test.tsx'],
      excludePatterns: [],
      sourceRoot: sourceRepo,
      testRoot: testRepo,
      // Absolute alias target, as config-loader.getMergedAliases produces.
      pathAliases: { '@dm/': path.join(sourceRepo, 'src/dm') },
    });

  test('scans both repos and tags each entry with its repo root', async () => {
    const reg = await build();
    const sources = reg.getFilesByType('source');
    const tests = reg.getFilesByType('test');

    const widget = sources.find((f) => f.path === 'src/dm/components/Widget.tsx');
    expect(widget).toBeDefined();
    expect(widget!.repoRoot).toBe(sourceRepo);

    const cypress = tests.find((f) => f.path === 'cypress/e2e/widget.cy.ts');
    expect(cypress).toBeDefined();
    expect(cypress!.repoRoot).toBe(testRepo); // tagged with the TEST repo

    const jest = tests.find((f) => f.path === 'src/dm/components/Widget.test.tsx');
    expect(jest).toBeDefined();
    expect(jest!.repoRoot).toBe(sourceRepo); // jest spec lives in the SOURCE repo
  });

  test('resolves a cross-repo @dm/ import back to the source file', async () => {
    const reg = await build();
    const cypress = reg.getFilesByType('test').find((f) => f.path === 'cypress/e2e/widget.cy.ts')!;
    // The spec's import of '@dm/components/Widget' (source repo) resolves to the
    // source registry key, even though the spec lives in a different repo.
    expect(cypress.imports).toContain('src/dm/components/Widget.tsx');
  });
});
