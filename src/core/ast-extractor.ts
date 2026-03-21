import ts from "typescript";
import { readFile } from "fs/promises";
import { join } from "path";
import type { IASTExtractionResult } from "../types.js";

const NOISE_WORDS = new Set([
  "the", "a", "an", "is", "get", "set", "has", "to", "from", "with",
  "for", "of", "in", "on", "at", "by", "do", "be", "it", "or", "if",
  "as", "up", "so", "no", "me", "my", "we", "us",
]);

function splitCamelCase(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter((word) => word.length > 1 && !NOISE_WORDS.has(word));
}

function walk(node: ts.Node, result: IASTExtractionResult): void {
  const isExported = (node as ts.HasModifiers).modifiers?.some(
    (m) => m.kind === ts.SyntaxKind.ExportKeyword
  );

  if (ts.isClassDeclaration(node) && node.name) {
    result.classes.push(node.name.text);
    if (isExported) result.exports.push(node.name.text);
  }

  if (ts.isFunctionDeclaration(node) && node.name) {
    result.functions.push(node.name.text);
    if (isExported) result.exports.push(node.name.text);
  }

  if (ts.isInterfaceDeclaration(node)) {
    result.interfaces.push(node.name.text);
    if (isExported) result.exports.push(node.name.text);
  }

  if (ts.isTypeAliasDeclaration(node)) {
    result.interfaces.push(node.name.text);
    if (isExported) result.exports.push(node.name.text);
  }

  if (ts.isVariableStatement(node) && isExported) {
    node.declarationList.declarations.forEach((decl) => {
      if (ts.isIdentifier(decl.name)) {
        result.exports.push(decl.name.text);
      }
    });
  }

  if (ts.isImportDeclaration(node)) {
    const moduleSpecifier = node.moduleSpecifier;
    if (ts.isStringLiteral(moduleSpecifier)) {
      result.imports.push(moduleSpecifier.text);
    }
  }

  ts.forEachChild(node, (child) => walk(child, result));
}

export class ASTExtractor {
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  async extractFromFile(filePath: string): Promise<IASTExtractionResult> {
    const result: IASTExtractionResult = {
      exports: [],
      classes: [],
      functions: [],
      interfaces: [],
      imports: [],
    };

    const ext = filePath.split(".").pop()?.toLowerCase();
    if (!ext || !["ts", "tsx"].includes(ext)) {
      return result;
    }

    try {
      const absolutePath = filePath.startsWith("/")
        ? filePath
        : join(this.cwd, filePath);

      const content = await readFile(absolutePath, "utf-8");
      if (!content.trim()) return result;

      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true
      );

      walk(sourceFile, result);
    } catch {
      // Return partial result on parse errors — don't crash
    }

    return result;
  }

  toKeywords(result: IASTExtractionResult): string[] {
    const allNames = [
      ...result.exports,
      ...result.classes,
      ...result.functions,
      ...result.interfaces,
    ];

    const keywords = new Set<string>();
    for (const name of allNames) {
      keywords.add(name.toLowerCase());
      for (const word of splitCamelCase(name)) {
        if (!NOISE_WORDS.has(word)) keywords.add(word);
      }
    }

    return Array.from(keywords).sort();
  }

  detectFileType(filePath: string): "source" | "test" {
    const normalized = filePath.replace(/\\/g, "/");
    if (
      normalized.includes("__tests__/") ||
      normalized.includes("/tests/") ||
      normalized.match(/\.(test|spec)\.(ts|tsx)$/)
    ) {
      return "test";
    }
    return "source";
  }
}
