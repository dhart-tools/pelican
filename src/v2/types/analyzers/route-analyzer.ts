/**
 * Represents the result of a route extraction process for a single file.
 */
export interface IRouteExtractionResult {
  /** The file path where the routes were extracted from. */
  filePath: string;
  /** List of route definitions found in the file. */
  routes: IRouteDef[];
}

/**
 * Detailed definition of a single route.
 */
export interface IRouteDef {
  /** The URL path pattern (e.g., '/login', '/user/:id'). */
  path: string;
  /** The name of the React component associated with this route. */
  component: string;
  /** The resolved file path of the component, if identifiable. */
  componentPath?: string;
  /** Whether the route is loaded lazily via dynamic import. */
  isLazy: boolean;
  /** Whether the route contains dynamic parameters or wildcards. */
  isDynamic: boolean;
  /** Additional metadata about the route. */
  metadata?: {
    /** Whether this is an index route (no path segment). */
    index?: boolean;
    /** The name of the layout/wrapper component, if any. */
    layout?: string;
    /** Nested child routes. */
    children?: IRouteDef[];
  };
}

/**
 * Maps component local names to their relative import specifiers.
 * Used during analysis to resolve non-lazy component file paths.
 */
export interface IImportMap {
  [componentName: string]: string;
}

// IAliasMap
// A flat map of alias prefix → absolute directory it points to.
// Built by AliasResolver from tsconfig / vite / webpack config files,
// then optionally extended/overridden by the user via IAliasResolverConfig.
//
// Keys are the alias prefix WITHOUT trailing slash or glob (/* stripped).
// Values are absolute filesystem paths to the target directory.
//
// Examples:
//   { '@':           '/project/src' }
//     → import X from '@/pages/Home'    resolves to /project/src/pages/Home
//
//   { '@pages':      '/project/src/pages' }
//     → import X from '@pages/Login'    resolves to /project/src/pages/Login
//
//   { '~':           '/project/src' }
//     → import X from '~/utils/format'  resolves to /project/src/utils/format
//
//   { '@utils':      '/project/src/utils',
//     '@components': '/project/src/components' }
//     → multiple aliases, longest prefix matched first to avoid ambiguity
export interface IAliasMap {
  [aliasPrefix: string]: string; // alias prefix (no trailing /) → absolute fs path
}

// IAliasResolverConfig
// Passed to RouteAnalyzer.extract() via the aliasConfig field to control
// how aliases are detected and resolved.
//
// Fields:
//   projectRoot  — Absolute path to the project root. Used to locate config
//                  files (tsconfig.json, vite.config.ts, webpack.config.js)
//                  and to resolve relative alias targets found inside them.
//                  Default: directory of the file being analyzed.
//
//   aliases      — User-supplied alias overrides. Merged LAST so they always
//                  win over anything auto-detected from config files.
//                  Values may be relative (resolved against projectRoot)
//                  or absolute.
//                  Example: { '@': 'src', '@utils': 'src/utils' }
//
//   configFiles  — Which config file(s) to read aliases from.
//                  Default: ['tsconfig', 'vite', 'webpack']
//                  Pass [] to skip all auto-detection and rely only on aliases.
export interface IAliasResolverConfig {
  projectRoot?: string;
  aliases?: Record<string, string>;
  configFiles?: Array<'tsconfig' | 'vite' | 'webpack'>;
}