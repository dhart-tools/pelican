import { normalizePath } from '@/core/registry/path-utils';
import { ITranslationIndex, IReduxChain, IImportGraph } from '@/types/analyzers';
import { IRegistry, IFileEntry } from '@/types/registry';
import { normalizeTestSelector } from '@/utils/selector-normalize';

export class Registry implements IRegistry {
  public files: Map<string, IFileEntry> = new Map();
  public importGraph: IImportGraph = {
    dependencies: new Map(),
    dependents: new Map(),
  };

  // Indexes (internal)
  private selectorIndex: Map<string, Set<string>> = new Map();
  private routeMap: Map<string, string> = new Map();
  private translationIndex: ITranslationIndex = {
    keyToText: new Map(),
    textToKeys: new Map(),
    keyToFiles: new Map(),
    dynamicKeys: new Set(),
    keyToStaticText: new Map(),
  };
  private reduxChains: Map<string, IReduxChain> = new Map();
  private textIndex: Map<string, Set<string>> = new Map();
  private actionTypeIndex: Map<string, Set<string>> = new Map();

  // ========== Index Methods ==========

  getSelectorIndex(): Map<string, Set<string>> {
    return this.selectorIndex;
  }

  setSelectorIndex(index: Map<string, Set<string>>): void {
    this.selectorIndex = index;
  }

  getRouteMap(): Map<string, string> {
    return this.routeMap;
  }

  setRouteMap(map: Map<string, string>): void {
    this.routeMap = map;
  }

  getTranslationIndex(): ITranslationIndex {
    return this.translationIndex;
  }

  setTranslationIndex(index: ITranslationIndex): void {
    this.translationIndex = index;
  }

  getReduxChains(): Map<string, IReduxChain> {
    return this.reduxChains;
  }

  setReduxChains(chains: Map<string, IReduxChain>): void {
    this.reduxChains = chains;
  }

  getTextIndex(): Map<string, Set<string>> {
    return this.textIndex;
  }

  setTextIndex(index: Map<string, Set<string>>): void {
    this.textIndex = index;
  }

  getActionTypeIndex(): Map<string, Set<string>> {
    return this.actionTypeIndex;
  }

  setActionTypeIndex(index: Map<string, Set<string>>): void {
    this.actionTypeIndex = index;
  }

  // ========== Query Methods ==========

  getFile(path: string): IFileEntry | undefined {
    return this.files.get(normalizePath(path));
  }

  getFilesByType(type: 'source' | 'test'): IFileEntry[] {
    return Array.from(this.files.values()).filter((f) => f.type === type);
  }

  getDependencies(filePath: string): Set<string> {
    return this.importGraph.dependencies.get(normalizePath(filePath)) || new Set();
  }

  getDependents(filePath: string): Set<string> {
    return this.importGraph.dependents.get(normalizePath(filePath)) || new Set();
  }

  // Lazy-built inverted index: selector value → number of TEST files that
  // reference it. Used to dampen ubiquitous-selector matches (e.g. `NavBar`
  // selectors appear in nearly every spec, so selector-match on NavBar should
  // not pin every spec to HIGH confidence).
  private testSelectorFreq: Map<string, number> | undefined;
  private testFileCountCache: number | undefined;

  private ensureTestSelectorFreq(): void {
    if (this.testSelectorFreq) return;
    const freq = new Map<string, number>();
    let tests = 0;
    for (const f of this.files.values()) {
      if (f.type !== 'test') continue;
      tests += 1;
      const seen = new Set<string>();
      const sels = f.cypress?.selectors || [];
      for (const s of sels) {
        const norm = normalizeTestSelector(s);
        const v = norm?.value;
        if (!v || seen.has(v)) continue;
        seen.add(v);
        freq.set(v, (freq.get(v) || 0) + 1);
      }
    }
    this.testSelectorFreq = freq;
    this.testFileCountCache = tests;
  }

  getTestSelectorFrequency(value: string): number {
    this.ensureTestSelectorFreq();
    return this.testSelectorFreq!.get(value) || 0;
  }

  getTestFileCount(): number {
    this.ensureTestSelectorFreq();
    return this.testFileCountCache || 0;
  }

  // ========== Build Methods ==========

  buildFromFileEntries(entries: IFileEntry[]): void {
    // Clear existing data
    this.files.clear();
    this.importGraph.dependencies.clear();
    this.importGraph.dependents.clear();
    this.selectorIndex.clear();
    this.routeMap.clear();
    this.textIndex.clear();
    this.actionTypeIndex.clear();

    for (const entry of entries) {
      const normalizedEntry = {
        ...entry,
        path: normalizePath(entry.path),
        imports: entry.imports.map((p) => normalizePath(p)),
      };
      this.files.set(normalizedEntry.path, normalizedEntry);
    }

    // Build indexes from the normalized entries stored in this.files
    const normalizedEntries = Array.from(this.files.values());
    this.buildImportGraph(normalizedEntries);
    this.buildSelectorIndex(normalizedEntries);
    this.buildRouteMap(normalizedEntries);
    this.buildTextIndex(normalizedEntries);
    this.buildActionTypeIndex(normalizedEntries);
  }

  buildImportGraph(entries: IFileEntry[]): void {
    for (const entry of entries) {
      const filePath = entry.path;

      const deps = this.importGraph.dependencies.get(filePath) || new Set();
      for (const importPath of entry.imports) {
        deps.add(importPath);

        const dependents = this.importGraph.dependents.get(importPath) || new Set();
        dependents.add(filePath);
        this.importGraph.dependents.set(importPath, dependents);
      }
      this.importGraph.dependencies.set(filePath, deps);
    }
  }

  buildSelectorIndex(entries: IFileEntry[]): void {
    for (const entry of entries) {
      if (entry.type === 'source' && entry.selectors) {
        for (const selector of entry.selectors) {
          const files = this.selectorIndex.get(selector.value) || new Set();
          files.add(entry.path);
          this.selectorIndex.set(selector.value, files);
        }
      }
    }
  }

  buildRouteMap(entries: IFileEntry[]): void {
    // Global index: component tag name (PascalCase) → source file path.
    // Used to resolve `<Route path="/foo"><BarContainer/></Route>` to BarContainer's file.
    const componentIndex = new Map<string, string>();
    for (const e of entries) {
      if (e.type !== 'source') continue;
      const base = e.path.split('/').pop() ?? '';
      const name = base.replace(/\.(tsx?|jsx?|mts|cts|mjs|cjs)$/i, '');
      if (name === 'index') {
        const parent = e.path.split('/').slice(-2, -1)[0];
        if (parent && !componentIndex.has(parent)) componentIndex.set(parent, e.path);
      } else if (!componentIndex.has(name)) {
        componentIndex.set(name, e.path);
      }
    }

    for (const entry of entries) {
      if (entry.type !== 'source' || !entry.routesDefined) continue;
      for (const route of entry.routesDefined) {
        // 1. Prefer: declaring file's resolved imports whose basename matches the tag name.
        let target: string | undefined;
        for (const imp of entry.imports) {
          const base = (imp.split('/').pop() ?? '').replace(/\.(tsx?|jsx?|mts|cts|mjs|cjs)$/i, '');
          if (base === route.component) { target = imp; break; }
          // index.tsx: match parent dir
          if (base === 'index') {
            const parent = imp.split('/').slice(-2, -1)[0];
            if (parent === route.component) { target = imp; break; }
          }
        }
        // 2. Fallback: global component-name index.
        if (!target) target = componentIndex.get(route.component);
        // 3. Last resort: the declaring file itself (old behavior).
        if (!target) target = entry.path;
        this.routeMap.set(route.path, target);
      }
    }
  }

  buildTextIndex(entries: IFileEntry[]): void {
    for (const entry of entries) {
      if (entry.jsxTextContent) {
        for (const text of entry.jsxTextContent) {
          const normalizedText = text.toLowerCase().trim();
          if (normalizedText.length > 3) {
            const files = this.textIndex.get(normalizedText) || new Set();
            files.add(entry.path);
            this.textIndex.set(normalizedText, files);
          }
        }
      }
    }
  }

  // Inverted index of Redux-action-type-shaped string literals to file paths
  // that reference them. Lets the action-type scorer find tests/sources that
  // share an action-type contract without sharing an import edge (e.g. a saga
  // that listens to another slice's action by string).
  buildActionTypeIndex(entries: IFileEntry[]): void {
    for (const entry of entries) {
      if (!entry.actionTypeStrings) continue;
      for (const s of entry.actionTypeStrings) {
        const files = this.actionTypeIndex.get(s) || new Set();
        files.add(entry.path);
        this.actionTypeIndex.set(s, files);
      }
    }
  }

  // ========== Helper Methods ==========

  addOrUpdateFile(entry: IFileEntry): void {
    const normalizedEntry = {
      ...entry,
      path: normalizePath(entry.path),
      imports: entry.imports.map((p) => normalizePath(p)),
    };

    // IMPORTANT: Remove stale import graph edges before re-adding.
    this.removeFileFromImportGraph(normalizedEntry.path);

    this.files.set(normalizedEntry.path, normalizedEntry);

    this.addFileToImportGraph(normalizedEntry);

    if (normalizedEntry.type === 'source') {
      this.addFileToSelectorIndex(normalizedEntry);
      this.addFileToRouteMap(normalizedEntry);
      this.addFileToTextIndex(normalizedEntry);
    }
  }

  private removeFileFromImportGraph(filePath: string): void {
    const oldDeps = this.importGraph.dependencies.get(filePath);
    if (oldDeps) {
      for (const dep of oldDeps) {
        const dependents = this.importGraph.dependents.get(dep);
        if (dependents) {
          dependents.delete(filePath);
          if (dependents.size === 0) {
            this.importGraph.dependents.delete(dep);
          }
        }
      }
    }
    this.importGraph.dependencies.delete(filePath);
  }

  private addFileToImportGraph(entry: IFileEntry): void {
    const filePath = entry.path;
    const deps = this.importGraph.dependencies.get(filePath) || new Set();

    for (const importPath of entry.imports) {
      deps.add(importPath);

      const dependents = this.importGraph.dependents.get(importPath) || new Set();
      dependents.add(filePath);
      this.importGraph.dependents.set(importPath, dependents);
    }

    this.importGraph.dependencies.set(filePath, deps);
  }

  private addFileToSelectorIndex(entry: IFileEntry): void {
    if (!entry.selectors) return;

    for (const selector of entry.selectors) {
      const files = this.selectorIndex.get(selector.value) || new Set();
      files.add(entry.path);
      this.selectorIndex.set(selector.value, files);
    }
  }

  private addFileToRouteMap(entry: IFileEntry): void {
    if (!entry.routesDefined) return;

    for (const route of entry.routesDefined) {
      this.routeMap.set(route.path, entry.path);
    }
  }

  private addFileToTextIndex(entry: IFileEntry): void {
    if (!entry.jsxTextContent) return;

    for (const text of entry.jsxTextContent) {
      const normalizedText = text.toLowerCase().trim();
      if (normalizedText.length > 3) {
        const files = this.textIndex.get(normalizedText) || new Set();
        files.add(entry.path);
        this.textIndex.set(normalizedText, files);
      }
    }
  }

  // ========== Persistence ==========

  serialize(): string {
    const data = {
      files: Array.from(this.files.entries()),
      importGraph: {
        dependencies: Array.from(this.importGraph.dependencies, ([k, v]) => [k, Array.from(v)]),
        dependents: Array.from(this.importGraph.dependents, ([k, v]) => [k, Array.from(v)]),
      },
      selectorIndex: Array.from(this.selectorIndex.entries()).map(([k, v]) => [k, Array.from(v)]),
      routeMap: Array.from(this.routeMap.entries()),
      translationIndex: {
        keyToText: Array.from(this.translationIndex.keyToText.entries()),
        textToKeys: Array.from(this.translationIndex.textToKeys.entries()),
        keyToFiles: Array.from(this.translationIndex.keyToFiles.entries()).map(([k, v]) => [
          k,
          Array.from(v),
        ]),
        dynamicKeys: Array.from(this.translationIndex.dynamicKeys),
        keyToStaticText: Array.from(this.translationIndex.keyToStaticText.entries()),
      },
      reduxChains: Array.from(this.reduxChains.entries()),
      textIndex: Array.from(this.textIndex.entries()).map(([k, v]) => [k, Array.from(v)]),
      actionTypeIndex: Array.from(this.actionTypeIndex.entries()).map(([k, v]) => [
        k,
        Array.from(v),
      ]),
    };

    return JSON.stringify(data, null, 2);
  }

  deserialize(data: string): void {
    const parsed = JSON.parse(data);

    this.files = new Map(parsed.files);

    this.importGraph.dependencies = new Map(
      parsed.importGraph.dependencies.map(([k, v]: [string, string[]]) => [k, new Set(v)]),
    );
    this.importGraph.dependents = new Map(
      parsed.importGraph.dependents.map(([k, v]: [string, string[]]) => [k, new Set(v)]),
    );

    this.selectorIndex = new Map(
      parsed.selectorIndex.map(([k, v]: [string, string[]]) => [k, new Set(v)]),
    );

    this.routeMap = new Map(parsed.routeMap);

    this.translationIndex = {
      keyToText: new Map(parsed.translationIndex.keyToText),
      textToKeys: new Map(parsed.translationIndex.textToKeys),
      keyToFiles: new Map(
        parsed.translationIndex.keyToFiles.map(([k, v]: [string, string[]]) => [k, new Set(v)]),
      ),
      dynamicKeys: new Set(parsed.translationIndex.dynamicKeys || []),
      keyToStaticText: new Map(parsed.translationIndex.keyToStaticText || []),
    };

    this.reduxChains = new Map(parsed.reduxChains);

    this.textIndex = new Map(parsed.textIndex.map(([k, v]: [string, string[]]) => [k, new Set(v)]));

    this.actionTypeIndex = new Map(
      (parsed.actionTypeIndex || []).map(([k, v]: [string, string[]]) => [k, new Set(v)]),
    );
  }
}

// Factory function
export function createRegistry(): IRegistry {
  return new Registry();
}
