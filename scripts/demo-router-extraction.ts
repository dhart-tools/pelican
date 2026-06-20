/**
 * One-shot demo: run RouteAnalyzer against the real dm-web Router.tsx
 * with a mocked resolveConstImport for RouterPath, then print everything
 * we extract. Used to verify the parens/wrapper/namespace/enum fixes end
 * to end without depending on the full pelican setup pipeline.
 *
 * Run: npx tsx scripts/demo-router-extraction.ts
 */
import * as fs from 'fs';
import * as path from 'path';

import { RouteAnalyzer } from '../src/core/analyzers/route-analyzer/route-analyzer';

const debugDir = path.resolve('pelican-debug 2');
const routerPath = path.join(debugDir, 'Router.tsx');
const source = fs.readFileSync(routerPath, 'utf-8');

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

async function main(): Promise<void> {
  const analyzer = new RouteAnalyzer();

  const result = await analyzer.extract({
    filePath: routerPath,
    sourceCode: source,
    aliasConfig: {
      projectRoot: process.cwd(),
      configFiles: [],
      aliases: { '@dm': 'src/dm', '@src': 'src' },
    },
    resolveConstImport: async (spec) =>
      spec === '@dm/constants/Routes' ? routerPathConst : null,
  });

  console.log('=== RouteAnalyzer.extract() result ===');
  console.log(`File: ${result.filePath}`);
  console.log(`Routes extracted: ${result.routes.length}\n`);

  console.log('PATH                                          | COMPONENT                                | COMPONENT PATH');
  console.log('-'.repeat(170));
  for (const route of result.routes) {
    const p = route.path.padEnd(45);
    const c = (route.component ?? '').padEnd(40);
    const cp = route.componentPath ?? '(unresolved)';
    console.log(`${p} | ${c} | ${cp}`);
  }

  console.log('\n=== buildRouteMap() merged ===');
  const routeMap = analyzer.buildRouteMap([result]);
  console.log(`Map entries: ${routeMap.size}\n`);
  for (const [routePath, componentPath] of routeMap) {
    console.log(`  ${routePath.padEnd(45)} → ${componentPath}`);
  }

  console.log('\n=== Verification: paths that the 4 missing tests visit ===');
  const visitPaths = ['/managedevices', '/managedevices/zones/:zoneId'];
  for (const v of visitPaths) {
    const found = routeMap.get(v);
    console.log(`  ${v.padEnd(45)} → ${found ?? '!! MISSING'}`);
  }
}

main().catch((err) => {
  console.error('demo failed:', err);
  process.exit(1);
});
