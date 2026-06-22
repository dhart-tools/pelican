import { buildStructuredTestExcerpt } from '@/core/rerank/test-payload';

const SPEC = `
import { foo } from '@fixtures/x';
/* This spec verifies the user can start a provisioning session and sees a success message */
describe('Start Provisioning Session', () => {
  before(() => {
    cy.envLogin();
    cy.addNewFacility('f', 'f');
    cy.addDeviceGroup('g');
  });
  it('starts provisioning from PCU dashboard', () => {
    cy.startProvisioningFromPCU('g');
    cy.get('[data-test-id="x"]').should('be.visible');
    cy.assertProvisioningStatus('dev', 'Yes');
  });
});
`;

describe('buildStructuredTestExcerpt', () => {
  it('extracts purpose, scenarios, actions, assertions', () => {
    const out = buildStructuredTestExcerpt(SPEC);
    expect(out).toContain('PURPOSE: This spec verifies the user can start a provisioning session');
    expect(out).toContain(
      'SCENARIOS: Start Provisioning Session | starts provisioning from PCU dashboard',
    );
    expect(out).toContain('cy.startProvisioningFromPCU');
    expect(out).toContain('cy.assertProvisioningStatus');
    expect(out).toContain('ASSERTIONS: be.visible');
  });

  it('captures actions from the WHOLE file, not just the first chars', () => {
    // a later it() block's action must still appear
    const big =
      `describe('d', () => {\n` +
      'x'.repeat(9000) +
      `\n  it('late', () => { cy.deepLateAction(); });\n});`;
    expect(buildStructuredTestExcerpt(big)).toContain('cy.deepLateAction');
  });

  it('dedupes repeated commands and titles', () => {
    const dup = `describe('d', () => { it('a', () => { cy.run(); cy.run(); cy.run(); }); });`;
    const out = buildStructuredTestExcerpt(dup);
    expect(out.match(/cy\.run/g)).toHaveLength(1);
  });

  it('degrades gracefully — no comment / no assertions', () => {
    const out = buildStructuredTestExcerpt(
      `describe('only', () => { it('t', () => { cy.act(); }); });`,
    );
    expect(out).not.toContain('PURPOSE:'); // no header comment → line omitted
    expect(out).toContain('SCENARIOS: only | t');
    expect(out).toContain('ASSERTIONS: —');
  });

  it('returns empty string for empty input (caller falls back)', () => {
    expect(buildStructuredTestExcerpt('')).toBe('');
    expect(buildStructuredTestExcerpt('   ')).toBe('');
  });
});
