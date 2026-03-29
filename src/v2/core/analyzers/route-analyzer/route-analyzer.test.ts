import * as fs from 'fs';
import * as path from 'path';

import { RouteAnalyzer, AliasResolver } from '@v2/core/analyzers/route-analyzer/route-analyzer';

describe('RouteAnalyzer', () => {
  let analyzer: RouteAnalyzer;

  beforeEach(() => {
    analyzer = new RouteAnalyzer();
  });

  /**
   * @description Verifies that the analyzer extracts simple JSX route definitions and resolves their component paths.
   */
  test('extract(): should extract basic JSX routes and resolve imports', async () => {
    const filePath = path.resolve('/project/src/App.tsx');
    const sourceCode = `
      import HomePage from './pages/Home';
      import { LoginPage } from './pages/Auth';
      import { Route, Routes, BrowserRouter } from 'react-router-dom';

      export default function App() {
        return (
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/login" element={<LoginPage />} />
            </Routes>
          </BrowserRouter>
        );
      }
    `;

    const result = await analyzer.extract({ filePath, sourceCode });

    expect(result.routes).toHaveLength(2);

    expect(result.routes[0].path).toBe('/');
    expect(result.routes[0].component).toBe('HomePage');
    expect(result.routes[0].componentPath).toBe(path.resolve('/project/src/pages/Home.ts'));

    expect(result.routes[1].path).toBe('/login');
    expect(result.routes[1].component).toBe('LoginPage');
    expect(result.routes[1].componentPath).toBe(path.resolve('/project/src/pages/Auth.ts'));
  });

  /**
   * @description Ensures dynamic routes and index routes are correctly identified and tagged.
   */
  test('extract(): should handle dynamic and index routes in JSX', async () => {
    const filePath = path.resolve('/project/src/App.tsx');
    const sourceCode = `
      import { Route, Routes } from 'react-router-dom';
      import UserProfile from './pages/User';

      export const Router = () => (
        <Routes>
          <Route index element={<Home />} />
          <Route path="user/:id" element={<UserProfile />} />
        </Routes>
      );
    `;

    const result = await analyzer.extract({ filePath, sourceCode });

    const indexRoute = result.routes.find((r) => r.metadata?.index);
    const dynamicRoute = result.routes.find((r) => r.isDynamic);

    expect(indexRoute?.path).toBe('');
    expect(dynamicRoute?.path).toBe('user/:id');
    expect(dynamicRoute?.isDynamic).toBe(true);
  });

  /**
   * @description Validates extraction of object-based route configurations used with createBrowserRouter.
   */
  test('extract(): should extract routes from createBrowserRouter config', async () => {
    const filePath = path.resolve('/project/src/main.tsx');
    const sourceCode = `
      import { createBrowserRouter } from 'react-router-dom';
      import Dashboard from './Dashboard';

      const router = createBrowserRouter([
        { path: '/', element: <Landing /> },
        { path: '/dash', element: <Dashboard /> }
      ]);
    `;

    const result = await analyzer.extract({ filePath, sourceCode });

    expect(result.routes).toHaveLength(2);
    expect(result.routes[1].path).toBe('/dash');
    expect(result.routes[1].component).toBe('Dashboard');
  });

  /**
   * @description Verifies path stitching for nested route configurations.
   */
  test('extract(): should stitch paths for nested children routes', async () => {
    const filePath = path.resolve('/project/src/App.tsx');
    const sourceCode = `
      const routes = [
        {
          path: '/admin',
          element: <AdminLayout />,
          children: [
            { path: 'users', element: <UserList /> },
            { path: 'settings', element: <Settings /> }
          ]
        }
      ];
    `;

    const result = await analyzer.extract({ filePath, sourceCode });

    // Expect 3 total: admin, admin/users, admin/settings
    expect(result.routes).toHaveLength(3);

    expect(result.routes[0].path).toBe('/admin');
    expect(result.routes[1].path).toBe('/admin/users');
    expect(result.routes[2].path).toBe('/admin/settings');
  });

  /**
   * @description Ensures lazy-loaded routes with dynamic imports are correctly handled.
   */
  test('extract(): should handle lazy-loaded routes via lazy()', async () => {
    const filePath = path.resolve('/project/src/App.tsx');
    const sourceCode = `
      import { lazy } from 'react';
      const Admin = lazy(() => import('./pages/Admin'));

      const config = [
        { path: '/admin', lazy: () => import('./pages/Admin') }
      ];
    `;

    const result = await analyzer.extract({ filePath, sourceCode });

    expect(result.routes[0].isLazy).toBe(true);
    expect(result.routes[0].componentPath).toBe(path.resolve('/project/src/pages/Admin.ts'));
  });

  /**
   * @description Validates the route map builder which flattens extraction results into a usable lookup map.
   */
  test('buildRouteMap(): should flatten extractions into a path lookup map', () => {
    const extractions = [
      {
        filePath: 'App.tsx',
        routes: [
          {
            path: '/',
            component: 'Home',
            componentPath: 'src/Home.ts',
            isLazy: false,
            isDynamic: false,
          },
        ],
      },
    ];

    const routeMap = analyzer.buildRouteMap(extractions);
    expect(routeMap.get('/')).toBe('src/Home.ts');
  });
});

describe('AliasResolver', () => {
  /**
   * @description Verifies that AliasResolver correctly resolves various aliased import strings into absolute paths.
   */
  test('resolve(): should expand alias prefixes to absolute paths', () => {
    const resolver = new AliasResolver({
      configFiles: [],
      aliases: {
        '@': '/project/src',
        '@pages': '/project/src/pages',
        '~': '/project/src',
      },
    });

    // Alias matches
    expect(resolver.resolve('@/pages/Home')).toBe(path.join('/project/src/pages/Home'));
    expect(resolver.resolve('@pages/Login')).toBe(path.join('/project/src/pages/Login'));
    expect(resolver.resolve('~/utils/format')).toBe(path.join('/project/src/utils/format'));

    // Relative/Absolute imports unchanged
    expect(resolver.resolve('./Home')).toBe('./Home');
    expect(resolver.resolve('/abs/path')).toBe('/abs/path');

    // Non-matching third-party
    expect(resolver.resolve('react')).toBe('react');
  });

  /**
   * @description Ensures that longest alias prefixes are matched first to prevent shorter ones from swallowing others.
   */
  test('resolve(): should match longest prefix first', () => {
    const resolver = new AliasResolver({
      configFiles: [],
      aliases: {
        '@': '/project/src',
        '@components': '/project/src/components',
      },
    });

    expect(resolver.resolve('@components/Button')).toBe(
      path.join('/project/src/components/Button'),
    );
    expect(resolver.resolve('@/utils')).toBe(path.join('/project/src/utils'));
  });

  describe('Config loading', () => {
    const tmpDir = path.resolve('/tmp/pelican-alias-test');

    beforeAll(() => {
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
    });

    afterAll(() => {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('loadFromTsConfig(): should read paths from tsconfig.json', () => {
      const tsconfigPath = path.join(tmpDir, 'tsconfig.json');
      fs.writeFileSync(
        tsconfigPath,
        JSON.stringify({
          compilerOptions: {
            baseUrl: '.',
            paths: { '@/*': ['src/*'] },
          },
        }),
      );

      const resolver = new AliasResolver({ projectRoot: tmpDir, configFiles: ['tsconfig'] });
      expect(resolver.resolve('@/pages/Home')).toBe(path.join(tmpDir, 'src/pages/Home'));
    });

    test('loadFromViteConfig(): should read aliases from vite.config.ts via regex', () => {
      const vitePath = path.join(tmpDir, 'vite.config.ts');
      fs.writeFileSync(
        vitePath,
        `
        export default defineConfig({
          resolve: {
            alias: { '@': path.resolve(__dirname, 'src') }
          }
        });
      `,
      );

      const resolver = new AliasResolver({ projectRoot: tmpDir, configFiles: ['vite'] });
      expect(resolver.resolve('@/pages/Home')).toBe(path.join(tmpDir, 'src/pages/Home'));
    });

    test('loadFromWebpackConfig(): should read aliases from webpack.config.js via regex', () => {
      const webpackPath = path.join(tmpDir, 'webpack.config.js');
      fs.writeFileSync(
        webpackPath,
        `
        module.exports = {
          resolve: {
            alias: { '@': path.resolve(__dirname, 'src/') }
          }
        };
      `,
      );

      const resolver = new AliasResolver({ projectRoot: tmpDir, configFiles: ['webpack'] });
      expect(resolver.resolve('@/pages/Home')).toBe(path.join(tmpDir, 'src/pages/Home'));
    });
  });
});

describe('RouteAnalyzer Alias Integration', () => {
  let analyzer: RouteAnalyzer;

  beforeEach(() => {
    analyzer = new RouteAnalyzer();
  });

  /**
   * @description Validates that RouteAnalyzer correctly uses AliasResolver to find component paths for aliased imports.
   */
  test('extract(): should resolve componentPath for @/ aliased imports', async () => {
    const filePath = path.resolve('/project/src/router.tsx');
    const sourceCode = `
      import HomePage from '@/pages/HomePage';
      import { Route } from 'react-router-dom';

      export const App = () => <Route path="/" element={<HomePage />} />;
    `;

    const result = await analyzer.extract({
      filePath,
      sourceCode,
      aliasConfig: {
        projectRoot: '/project',
        configFiles: [],
        aliases: { '@': 'src' },
      },
    });

    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].componentPath).toBe(path.resolve('/project/src/pages/HomePage.ts'));
  });

  /**
   * @description Verifies that RouteAnalyzer still handles relative imports correctly even when aliases are provided.
   */
  test('extract(): should handle mixed relative and aliased imports', async () => {
    const filePath = path.resolve('/project/src/App.tsx');
    const sourceCode = `
      import HomePage from './pages/HomePage';
      import LoginPage from '@/pages/LoginPage';

      export const Router = () => (
        <>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
        </>
      );
    `;

    const result = await analyzer.extract({
      filePath,
      sourceCode,
      aliasConfig: {
        projectRoot: '/project',
        configFiles: [],
        aliases: { '@': 'src' },
      },
    });

    const home = result.routes.find((r) => r.path === '/');
    const login = result.routes.find((r) => r.path === '/login');

    expect(home?.componentPath).toBe(path.resolve('/project/src/pages/HomePage.ts'));
    expect(login?.componentPath).toBe(path.resolve('/project/src/pages/LoginPage.ts'));
  });
});
