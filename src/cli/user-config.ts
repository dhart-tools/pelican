import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { setTheme, ThemeName } from './theme';

const CONFIG_DIR  = path.join(os.homedir(), '.pelican');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

interface UserConfig {
  theme: ThemeName;
}

const DEFAULTS: UserConfig = { theme: 'dark' };

export async function readUserConfig(): Promise<UserConfig> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function writeUserConfig(config: Partial<UserConfig>): Promise<void> {
  const current = await readUserConfig();
  const next = { ...current, ...config };
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf-8');
}

/** Load and apply the user's saved theme. Call this before render(). */
export async function loadTheme(): Promise<ThemeName> {
  const config = await readUserConfig();
  setTheme(config.theme);
  return config.theme;
}
