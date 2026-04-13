/**
 * Cypress built-in commands used for semantic extraction.
 */
export const BUILTIN_CYPRESS_COMMANDS = new Set([
  'visit',
  'get',
  'find',
  'contains',
  'click',
  'type',
  'submit',
  'trigger',
  'check',
  'uncheck',
  'select',
  'deselect',
  'scrollIntoView',
  'scrollTo',
  'dblclick',
  'rightclick',
  'hover',
  'focus',
  'blur',
  'clear',
  'selectFile',
  'clearFile',
  'intercept',
  'request',
  'wait',
  'as',
  'spread',
  'wrap',
  'within',
  'should',
  'and',
  'then',
  'invoke',
  'its',
  'spy',
  'stub',
  'clock',
  'tick',
  'viewport',
  'url',
  'location',
  'hash',
  'go',
  'reload',
  'back',
  'forward',
  'document',
  'window',
  'log',
  'debug',
  'pause',
]);

export const REGEX_TEST_ID = /\[data-testid=(["'])(.*?)\1\]/;
export const REGEX_DATA_CY = /\[data-cy=(["'])(.*?)\1\]/;
/**
 * Matches any `[<attr>="<value>"]` selector for attributes commonly used as
 * test IDs across codebases: data-test, data-qa, data-e2e, data-test-id,
 * data-automation-id. Capture groups: 1=attr name, 2=quote, 3=value.
 */
export const REGEX_GENERIC_TEST_ATTR =
  /\[(data-(?:test|qa|e2e|test-id|automation-id|automation|cy|testid))=(["'])(.*?)\2\]/;
export const REGEX_SELECTOR_SPLIT = /[.#[:]|\s+/;

export const SELECTOR_ATTRIBUTES = [
  'data-testid',
  'data-test-id',
  'data-test',
  'data-cy',
  'data-qa',
  'data-e2e',
  'data-automation',
  'data-automation-id',
  'dataTestId',
  'testId',
  'id',
  'aria-label',
];

/**
 * Custom command names that wrap `cy.get('[data-*="value"]')`.
 * The first string argument is the selector *value*, not a CSS selector.
 * Matches both call-site styles: `cy.getByTestId('x')`, `cy.findByDataCy('x')`.
 */
export const CUSTOM_SELECTOR_COMMAND_REGEX =
  /^(?:get|find)By(?:TestId|DataTestId|DataTest|DataCy|DataQa|DataE2e|Test|Cy|Qa|E2e|AutomationId|Id|Sel|SelLike|Selector)$/i;

export const PROJECT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
