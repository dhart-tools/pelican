import { getRepoRoot } from '@v2/core/git';

import { loadConfig, saveConfig } from '../config-loader';

/**
 * Handles operations on the .suggestorrc.json config file.
 */
export async function runConfig(
  action: 'get' | 'set' | 'list',
  key?: string,
  value?: string,
): Promise<void> {
  const projectRoot = getRepoRoot();
  const config = await loadConfig(projectRoot);

  switch (action) {
    case 'get':
      if (!key) throw new Error('Key is required for "get"');
      console.log(getInObject(config, key));
      break;

    case 'set':
      if (!key || value === undefined) throw new Error('Key and value are required for "set"');
      let parsedValue: any;
      try {
        parsedValue = JSON.parse(value);
      } catch {
        parsedValue = value;
      }
      setInObject(config, key, parsedValue);
      await saveConfig(projectRoot, config);
      console.log(`✅ Config set: ${key} = ${JSON.stringify(parsedValue)}`);
      break;

    case 'list':
      console.log(JSON.stringify(config, null, 2));
      break;
  }
}

function getInObject(obj: any, path: string): any {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

function setInObject(obj: any, path: string, value: any): void {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}
