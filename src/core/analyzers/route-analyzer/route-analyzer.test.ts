import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { RouteAnalyzer, AliasResolver } from '@/core/analyzers/route-analyzer/route-analyzer';

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

/**
 * Regression suite mirroring the real-world dm-web pattern reported in
 * pelican-debug 2/Router.tsx:
 *   - Paths come from an `export enum RouterPath` in a constants file
 *   - Each route's `element` is `{(<ProtectedRoute>...<NS.Container/></ProtectedRoute>)}`
 *   - Components are namespace-imported as `import * as DMContainers from ...`
 *
 * Before the parens/wrapper/namespace fix landed, only the literal `path="/"`
 * route was extracted because every other entry tripped over one of those
 * three patterns. These tests pin that exact shape so the regression can't
 * silently come back.
 */
describe('RouteAnalyzer — dm-web pattern (enum path + wrapper + namespace import)', () => {
  let analyzer: RouteAnalyzer;

  beforeEach(() => {
    analyzer = new RouteAnalyzer();
  });

  /**
   * Builds a resolveConstImport implementation that responds to the test's
   * specifier with the literal values declared in our virtual Routes.ts.
   * Kept inline so the test is self-contained (no fs/tmpdir plumbing).
   */
  const fakeConstResolver = () => {
    const routerPathConst = new Map<string, Record<string, string>>([
      [
        'RouterPath',
        {
          HOME: '/',
          NETWORK_PROFILES: '/networkprofiles',
          MOVE_DEVICES: '/movedevices',
          MANAGE_DEVICES: '/managedevices',
          ZONE_DEVICES_LIST: '/managedevices/zones/:zoneId',
          CREATE_NETWORK_PROFILE: '/networkprofiles/create',
        },
      ],
    ]);
    return async (importPath: string) => {
      if (importPath === '@dm/constants/Routes') return routerPathConst;
      return null;
    };
  };

  test('extracts every Route entry whose path is RouterPath.<MEMBER>', async () => {
    const filePath = path.resolve('/project/src/dm/Router.tsx');
    const sourceCode = `
      import { Routes, Route, Outlet } from 'react-router-dom'
      import { RouterPath } from '@dm/constants/Routes'
      import * as DMContainers from '@dm/containers'
      import { ProtectedRoute } from '@dm/components/Routing'

      const Router = () => (
        <Routes>
          <Route path="/" element={<Outlet />} />
          <Route
            path={RouterPath.NETWORK_PROFILES}
            element={(
              <ProtectedRoute>
                <DMContainers.NetworkProfilesContainer />
              </ProtectedRoute>
            )}
          />
          <Route
            path={RouterPath.MANAGE_DEVICES}
            element={(
              <ProtectedRoute>
                <DMContainers.ManageDevicesContainer />
              </ProtectedRoute>
            )}
          />
          <Route
            path={RouterPath.ZONE_DEVICES_LIST}
            element={(
              <ProtectedRoute>
                <DMContainers.ZoneDevicesList />
              </ProtectedRoute>
            )}
          />
          <Route
            path={RouterPath.MOVE_DEVICES}
            element={(
              <ProtectedRoute>
                <DMContainers.MoveDevicesContainer />
              </ProtectedRoute>
            )}
          />
        </Routes>
      )
      export default Router
    `;

    const result = await analyzer.extract({
      filePath,
      sourceCode,
      aliasConfig: {
        projectRoot: '/project',
        configFiles: [],
        aliases: {
          '@dm': 'src/dm',
          '@dm/containers': 'src/dm/containers',
          '@dm/constants/Routes': 'src/dm/constants/Routes',
          '@dm/components/Routing': 'src/dm/components/Routing',
        },
      },
      resolveConstImport: fakeConstResolver(),
    });

    const paths = result.routes.map((r) => r.path).sort();
    expect(paths).toEqual(
      [
        '/',
        '/managedevices',
        '/managedevices/zones/:zoneId',
        '/movedevices',
        '/networkprofiles',
      ].sort(),
    );
  });

  test('resolves componentPath through namespace import for <NS.Component/>', async () => {
    const filePath = path.resolve('/project/src/dm/Router.tsx');
    const sourceCode = `
      import { Route } from 'react-router-dom'
      import { RouterPath } from '@dm/constants/Routes'
      import * as DMContainers from '@dm/containers'
      import { ProtectedRoute } from '@dm/components/Routing'

      const Router = () => (
        <Route
          path={RouterPath.MANAGE_DEVICES}
          element={(
            <ProtectedRoute>
              <DMContainers.ManageDevicesContainer />
            </ProtectedRoute>
          )}
        />
      )
    `;

    const result = await analyzer.extract({
      filePath,
      sourceCode,
      aliasConfig: {
        projectRoot: '/project',
        configFiles: [],
        aliases: { '@dm': 'src/dm' },
      },
      resolveConstImport: fakeConstResolver(),
    });

    const manageDevices = result.routes.find((r) => r.path === '/managedevices');
    expect(manageDevices).toBeDefined();
    // The wrapper-drill should surface the inner component name.
    expect(manageDevices?.component).toBe('DMContainers.ManageDevicesContainer');
    // Namespace lookup → resolved to the barrel file via the namespace import.
    expect(manageDevices?.componentPath).toBe(path.resolve('/project/src/dm/containers.ts'));
  });

  test('falls back to declaring file when component cannot be resolved', async () => {
    // Inline component with no import — exercises buildRouteMap's fallback.
    const filePath = path.resolve('/project/src/dm/Router.tsx');
    const sourceCode = `
      import { Route } from 'react-router-dom'
      import { RouterPath } from '@dm/constants/Routes'

      const Router = () => (
        <Route
          path={RouterPath.MANAGE_DEVICES}
          element={<UnknownInlineComponent />}
        />
      )
    `;

    const result = await analyzer.extract({
      filePath,
      sourceCode,
      aliasConfig: {
        projectRoot: '/project',
        configFiles: [],
        aliases: { '@dm': 'src/dm' },
      },
      resolveConstImport: fakeConstResolver(),
    });

    const routeMap = analyzer.buildRouteMap([result]);
    // Path resolved via enum; componentPath unresolved → declaring file fallback.
    expect(routeMap.get('/managedevices')).toBe(filePath);
  });

  test('drops only the empty-path edge case; non-RouterPath paths still drop without a callback', async () => {
    const filePath = path.resolve('/project/src/dm/Router.tsx');
    const sourceCode = `
      import { Route } from 'react-router-dom'
      import { RouterPath } from '@dm/constants/Routes'

      const Router = () => (
        <>
          <Route path="/" element={<Home />} />
          <Route path={RouterPath.MANAGE_DEVICES} element={<Foo />} />
        </>
      )
    `;

    // No resolveConstImport callback supplied — RouterPath.MANAGE_DEVICES
    // can't resolve. Route with empty/unresolved path should NOT pollute
    // the map, but the literal "/" route should still survive.
    const result = await analyzer.extract({
      filePath,
      sourceCode,
      aliasConfig: { projectRoot: '/project', configFiles: [], aliases: {} },
    });

    const routeMap = analyzer.buildRouteMap([result]);
    expect(routeMap.has('/')).toBe(true);
    expect(routeMap.has('')).toBe(false);
  });

  /**
   * End-to-end against the actual fixture files copied from the dm-web debug
   * bundle. Demonstrates the full chain: enum resolution → wrapper drill →
   * namespace import → route map merge.
   *
   * If the fixtures change shape (e.g. enum members renamed), this test will
   * flag it loudly rather than masking the regression behind sample data.
   */
  test('end-to-end: real Router.tsx + Routes.ts from dm-web debug bundle', async () => {
    const debugDir = path.resolve(__dirname, '../../../../pelican-debug 2');
    const routerPath = path.join(debugDir, 'Router.tsx');
    if (!fs.existsSync(routerPath)) {
      // Skip silently if the debug bundle isn't checked in.
      return;
    }
    const routerSource = fs.readFileSync(routerPath, 'utf-8');

    // Inline RouterPath enum values matching the shape the user pasted. We
    // can't reach into the user's @bd-infusion package; instead we mock the
    // resolver to mimic what registry-builder.resolveTsConstImport would
    // return after reading the real Routes.ts.
    const routerPathConst = new Map<string, Record<string, string>>([
      [
        'RouterPath',
        {
          HOME: '/',
          CURRENT_USER: '/currentuser',
          VARIABLES: '/variables',
          NETWORK_PROFILE: '/networkprofiles/:profileKey',
          CREATE_NETWORK_PROFILE: '/networkprofiles/create',
          NETWORK_PROFILES: '/networkprofiles',
          CREATE_NETWORK_CONFIGURATIONS: '/networkconfigurations/create',
          CONFIG_ZONE: '/devicegroups/:zoneId',
          CREATE_CONFIG_ZONE: '/devicegroups/create',
          FACILITIES_AND_ZONES: '/devicegroups',
          MOVE_DEVICES: '/movedevices',
          FACILITY: '/facilities/:facilityId',
          CREATE_FACILITY: '/facilities/create',
          DEPLOY: '/deploy',
          NETWORK_CONFIGURATION_PACKAGES: '/networkconfigurationpackages',
          NETWORK_PROFILE_PACKAGE: '/networkconfigurationpackages/:packageId',
          FIRMWARE_PACKAGES: '/firmwarepackages',
          RFID_CONFIG_PACKAGES: '/rfidconfigpackages',
          MANAGE_DEVICES: '/managedevices',
          ZONE_DEVICES_LIST: '/managedevices/zones/:zoneId',
          EXTERNAL_SYSTEMS: '/externalsystems',
          DRUG_LIBRARY_PACKAGES: '/druglibrarypackages',
          SOFTWARE: '/software',
          SYSTEM_SETTINGS: '/systemsettings',
          SETTINGS: '/settings',
          LOCATION_MAPPING: '/locationmapping',
        },
      ],
    ]);

    const result = await analyzer.extract({
      filePath: routerPath,
      sourceCode: routerSource,
      aliasConfig: {
        projectRoot: path.resolve(__dirname, '../../../..'),
        configFiles: [],
        aliases: { '@dm': 'src/dm', '@src': 'src' },
      },
      resolveConstImport: async (spec) =>
        spec === '@dm/constants/Routes' ? routerPathConst : null,
    });

    const paths = new Set(result.routes.map((r) => r.path));

    // Spot-check the high-value entries — the 4 missing tests visit these.
    expect(paths.has('/managedevices')).toBe(true);
    expect(paths.has('/managedevices/zones/:zoneId')).toBe(true);
    expect(paths.has('/movedevices')).toBe(true);
    expect(paths.has('/networkprofiles')).toBe(true);

    // Sanity: more than the lone `/` route the broken extractor produced.
    expect(result.routes.length).toBeGreaterThan(20);

    const routeMap = analyzer.buildRouteMap([result]);
    expect(routeMap.get('/managedevices')).toBeDefined();
  });
});

/**
 * Barrel re-export resolution against REAL on-disk files.
 *
 * The dm-web Router imports page components from catch-all barrels
 * (`@dm/components`, `@dm/containers`). Before this fix, routes resolved to the
 * barrel (or, with trailing-slash alias keys, to nothing → the Router file),
 * making route-match match the entire app. These tests write a minimal but
 * real file tree to a temp dir and assert each route resolves to the actual
 * leaf page file, following named-default and nested-barrel re-export chains.
 */
describe('RouteAnalyzer — barrel re-export resolution (real files)', () => {
  let analyzer: RouteAnalyzer;
  let root: string;

  const write = (rel: string, contents: string) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  };

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pelican-route-'));

    // components barrel → named-default re-export → leaf component
    write(
      'src/dm/components/index.ts',
      `export { default as ManageDevices } from './ManageDevices'\n`,
    );
    write(
      'src/dm/components/ManageDevices/index.tsx',
      `export default function ManageDevices() { return null }\n`,
    );

    // Routing wrapper (named import, not a page)
    write(
      'src/dm/components/Routing/index.ts',
      `export const ProtectedRoute = (p: any) => p.children\n`,
    );

    // containers barrel → nested barrel → leaf
    write(
      'src/dm/containers/index.ts',
      `export { FirmwarePackagesContainer } from './firmwarePackages'\n`,
    );
    write(
      'src/dm/containers/firmwarePackages/index.ts',
      `export { FirmwarePackagesContainer } from './firmwarePackages'\n`,
    );
    write(
      'src/dm/containers/firmwarePackages/firmwarePackages.tsx',
      `export const FirmwarePackagesContainer = () => null\n`,
    );

    write(
      'src/dm/Router.tsx',
      `
      import { Route, Routes } from 'react-router-dom'
      import * as DMContainers from '@dm/containers'
      import { ManageDevices } from '@dm/components'
      import { ProtectedRoute } from '@dm/components/Routing'

      export default function Router() {
        return (
          <Routes>
            <Route path="/managedevices" element={(<ProtectedRoute><ManageDevices /></ProtectedRoute>)} />
            <Route path="/firmwarepackages" element={(<ProtectedRoute><DMContainers.FirmwarePackagesContainer /></ProtectedRoute>)} />
          </Routes>
        )
      }
      `,
    );
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    analyzer = new RouteAnalyzer();
  });

  const extractWithTrailingSlashAlias = () =>
    analyzer.extract({
      filePath: path.join(root, 'src/dm/Router.tsx'),
      sourceCode: fs.readFileSync(path.join(root, 'src/dm/Router.tsx'), 'utf-8'),
      // Trailing-slash key — the exact real-config shape that produced 0 resolutions.
      aliasConfig: { projectRoot: root, configFiles: [], aliases: { '@dm/': 'src/dm/' } },
    });

  test('named barrel import resolves through `export { default as X }` to the leaf component', async () => {
    const result = await extractWithTrailingSlashAlias();
    const route = result.routes.find((r) => r.path === '/managedevices');
    expect(route?.componentPath).toBe(path.join(root, 'src/dm/components/ManageDevices/index.tsx'));
  });

  test('namespace member resolves through a NESTED barrel chain to the leaf file', async () => {
    const result = await extractWithTrailingSlashAlias();
    const route = result.routes.find((r) => r.path === '/firmwarepackages');
    expect(route?.componentPath).toBe(
      path.join(root, 'src/dm/containers/firmwarePackages/firmwarePackages.tsx'),
    );
  });

  test('routes resolve to distinct page files, not a single shared barrel', async () => {
    const result = await extractWithTrailingSlashAlias();
    const paths = result.routes
      .filter((r) => r.path === '/managedevices' || r.path === '/firmwarepackages')
      .map((r) => r.componentPath);
    expect(new Set(paths).size).toBe(2);
    expect(paths.some((p) => /\/(components|containers)\/index\.tsx?$/.test(p ?? ''))).toBe(false);
  });
});
