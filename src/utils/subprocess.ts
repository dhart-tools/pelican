import * as path from 'path';

const CHILD_COMMAND_ENV = 'PELICAN_CHILD_COMMAND';
const CHILD_ARGS_ENV = 'PELICAN_CHILD_ARGS';

const WINDOWS_COMMAND =
  `$ErrorActionPreference = 'Stop'; ` +
  `try { ` +
  `$childCommand = $env:${CHILD_COMMAND_ENV}; ` +
  `$childArgs = $env:${CHILD_ARGS_ENV} | ConvertFrom-Json; ` +
  `& $childCommand @childArgs; ` +
  `if ($null -eq $LASTEXITCODE) { exit 0 }; ` +
  `exit $LASTEXITCODE ` +
  `} catch { Write-Error $_; exit 1 }`;

export interface IPreparedCommand {
  command: string;
  args: string[];
  env: Record<string, string | undefined>;
}

/**
 * Select an npm-generated command shim explicitly on Windows. This avoids a
 * same-named PowerShell wrapper earlier on PATH (for example VS Code's
 * copilot.ps1) from intercepting and re-quoting arguments.
 */
export function npmShimCommand(command: string, platform: string = process.platform): string {
  return platform === 'win32' ? `${command}.cmd` : command;
}

/**
 * Node cannot directly execute Windows .cmd/.ps1 command shims. Route them
 * through PowerShell while carrying arguments in JSON via the environment, so
 * prompt text is never interpolated into shell code.
 */
export function prepareCommand(
  command: string,
  args: string[],
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): IPreparedCommand {
  if (platform !== 'win32') return { command, args, env };

  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT;
  return {
    command: systemRoot
      ? path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe',
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_COMMAND],
    env: {
      ...env,
      [CHILD_COMMAND_ENV]: command,
      [CHILD_ARGS_ENV]: JSON.stringify(args),
    },
  };
}
