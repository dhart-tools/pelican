import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

import { npmShimCommand, prepareCommand } from '@/utils/subprocess';

const execFileP = promisify(execFile);

export type CopilotSetupRunner = (
  command: string,
  args: string[],
  options?: { timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

const defaultRunner: CopilotSetupRunner = async (command, args, options) => {
  const prepared = prepareCommand(command, args);
  const { stdout, stderr } = await execFileP(prepared.command, prepared.args, {
    ...options,
    env: prepared.env,
  });
  return { stdout: String(stdout), stderr: String(stderr) };
};

/** A PATH entry is not enough: VS Code can install a shim that exits 0 while the CLI is absent. */
export async function isCopilotInstalled(
  run: CopilotSetupRunner = defaultRunner,
): Promise<boolean> {
  try {
    const { stdout, stderr } = await run(npmShimCommand('copilot'), ['--version'], {
      timeout: 5000,
    });
    return /^GitHub Copilot CLI \d+\.\d+\.\d+/m.test(`${stdout}\n${stderr}`);
  } catch {
    return false;
  }
}

export async function installCopilot(run: CopilotSetupRunner = defaultRunner): Promise<void> {
  await run('npm', ['install', '-g', '@github/copilot'], { timeout: 300_000 });
}

function runInteractive(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const prepared = prepareCommand(npmShimCommand('copilot'), args);
    const child = spawn(prepared.command, prepared.args, {
      stdio: 'inherit',
      env: prepared.env,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`copilot ${args.join(' ')} exited with ${signal ?? `code ${code}`}`));
    });
  });
}

export async function loginCopilot(): Promise<void> {
  await runInteractive(['login']);
}
