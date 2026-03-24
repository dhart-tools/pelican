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

function mineJsxAttributes(node: ts.Node, result: IASTExtractionResult): void {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    node.attributes.properties.forEach((attr) => {
      if (ts.isJsxAttribute(attr)) {
        const name = attr.name.getText();
        if (["data-testid", "data-cy", "id", "aria-label", "name"].includes(name)) {
          const value = attr.initializer ? attr.initializer.getText().replace(/["']/g, "") : "";
          result.selectors.push({ attr: name, value });
        }
      }
    });
  }
}

function mineJsxText(node: ts.Node, result: IASTExtractionResult): void {
  if (ts.isJsxText(node)) {
    const text = node.text.trim();
    if (text && text.length > 3) result.jsxTextContent.push(text);
  }
}

function mineTranslationKeys(node: ts.Node, result: IASTExtractionResult): void {
  // Simple check for t('key')
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t") {
    if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
      result.translationKeys.push(node.arguments[0].text);
    }
  }
}

function mineRedux(node: ts.Node, result: IASTExtractionResult): void {
  // Simple check for useSelector(selector)
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useSelector") {
    if (node.arguments.length > 0 && ts.isIdentifier(node.arguments[0])) {
        result.reduxUsage.selectorsUsed.push(node.arguments[0].text);
    }
  }
  // Simple check for dispatch(action())
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "dispatch") {
      if (node.arguments.length > 0 && ts.isCallExpression(node.arguments[0])) {
          const arg = node.arguments[0];
          if (ts.isIdentifier(arg.expression)) {
              result.reduxUsage.actionsDispatched.push(arg.expression.text);
          }
      }
  }
}

function walk(node: ts.Node, result: IASTExtractionResult): void {
  mineJsxAttributes(node, result);
  mineJsxText(node, result);
  mineTranslationKeys(node, result);
  mineRedux(node, result);
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
      selectors: [],
      jsxTextContent: [],
      translationKeys: [],
      reduxUsage: {
        selectorsUsed: [],
        actionsDispatched: [],
        slicesDefined: [],
      },
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
      normalized.match(/\.(test|spec|cy|e2e|pw|playwright)\.(ts|tsx)$/)
    ) {
      return "test";
    }
    return "source";
  }
}
