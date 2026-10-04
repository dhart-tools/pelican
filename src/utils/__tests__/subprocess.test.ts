import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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

  (process.platform === 'win32' ? it : it.skip)(
    'passes multiple arguments separately to a Windows PowerShell shim',
    () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pelican-command-test-'));
      const outputPath = path.join(directory, 'args.json');
      const shimPath = path.join(directory, 'pelican-args.ps1');
      fs.writeFileSync(
        shimPath,
        'Set-Content -Path $env:PELICAN_TEST_OUTPUT -Value ($args | ConvertTo-Json -Compress)',
      );

      try {
        const prepared = prepareCommand('pelican-args', ['first', 'second', 'third'], {
          ...process.env,
          PATH: `${directory}${path.delimiter}${process.env.PATH}`,
          PELICAN_TEST_OUTPUT: outputPath,
        });
        execFileSync(prepared.command, prepared.args, { env: prepared.env });
        expect(JSON.parse(fs.readFileSync(outputPath, 'utf-8'))).toEqual([
          'first',
          'second',
          'third',
        ]);
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
