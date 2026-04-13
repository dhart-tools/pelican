import { ESelectorAttr } from '@/utils/enums';

// Unwraps a selector value that may be stored as a whole attribute-selector
// ("[data-test-id=SaveButton]", "[data-testid='name']") back to the raw
// test-id value ("SaveButton", "name"). Needed because the cypress extractor
// captures `cy.get(dataTestIds.x)` via JSON-fixture resolution as the full
// CSS selector string with `type: 'complex'`, while source files store the
// bare attribute value.
const COMPLEX_ATTR_RE = /^\s*\[\s*(data-[a-z][a-z0-9-]*)\s*=\s*["']?([^"'\]\s]+)["']?\s*\]\s*$/i;

export function normalizeTestSelector(raw: {
  type?: string;
  value?: string;
}): { type: string; value: string } | null {
  const value = raw.value;
  if (!value) return null;
  const type = raw.type || '';
  if (type === ESelectorAttr.TEST_ID || type === ESelectorAttr.DATA_CY) {
    return { type, value };
  }
  const m = COMPLEX_ATTR_RE.exec(value);
  if (m) {
    const attr = m[1].toLowerCase();
    const v = m[2];
    if (attr === 'data-testid' || attr === 'data-test-id' || attr === 'data-test') {
      return { type: ESelectorAttr.TEST_ID, value: v };
    }
    if (attr === 'data-cy') {
      return { type: ESelectorAttr.DATA_CY, value: v };
    }
    return { type: ESelectorAttr.TEST_ID, value: v };
  }
  return null;
}
