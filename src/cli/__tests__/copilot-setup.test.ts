import { jest } from '@jest/globals';

import { CopilotSetupRunner, installCopilot, isCopilotInstalled } from '@/cli/copilot-setup';

describe('Copilot setup commands', () => {
  it('accepts the real CLI version signature', async () => {
    const run: CopilotSetupRunner = async () => ({
      stdout: "GitHub Copilot CLI 1.0.91.\nRun 'copilot update' to check for updates.\n",
      stderr: '',
    });
    await expect(isCopilotInstalled(run)).resolves.toBe(true);
  });

  it('rejects the VS Code shim even when it exits successfully', async () => {
    const run: CopilotSetupRunner = async () => ({
      stdout: '',
      stderr: 'Cannot find GitHub Copilot CLI\nInstall GitHub Copilot CLI?',
    });
    await expect(isCopilotInstalled(run)).resolves.toBe(false);
  });

  it('rejects a missing command', async () => {
    const run: CopilotSetupRunner = async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    };
    await expect(isCopilotInstalled(run)).resolves.toBe(false);
  });

  it('installs the official npm package globally without sudo', async () => {
    const run: CopilotSetupRunner = jest.fn(async () => ({ stdout: '', stderr: '' }));
    await installCopilot(run);
    expect(run).toHaveBeenCalledWith('npm', ['install', '-g', '@github/copilot'], {
      timeout: 300_000,
    });
  });
});
