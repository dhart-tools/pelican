import { prepareCommand } from '@/utils/subprocess';

describe('prepareCommand', () => {
  it('keeps direct argument-array execution outside Windows', () => {
    const env = { PATH: '/usr/bin' };
    expect(prepareCommand('copilot', ['--version'], env, 'darwin')).toEqual({
      command: 'copilot',
      args: ['--version'],
      env,
    });
  });

  it('passes Windows shim arguments through the environment without shell interpolation', () => {
    const prompt = 'Judge $(touch nope) & echo nope | exit 1';
    const prepared = prepareCommand(
      'copilot',
      ['-p', prompt, '-s'],
      { SystemRoot: 'C:\\Windows', PATH: 'C:\\nvm4w\\nodejs' },
      'win32',
    );

    expect(prepared.command).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(prepared.args).not.toContain(prompt);
    expect(prepared.env.PELICAN_CHILD_COMMAND).toBe('copilot');
    expect(JSON.parse(prepared.env.PELICAN_CHILD_ARGS ?? '[]')).toEqual(['-p', prompt, '-s']);
  });
});
