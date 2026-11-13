import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { ConfigError } from './errors.js';

export interface DataMount {
  /** Relative host-side name, becomes ./data/<host> on the machine. */
  host: string;
  /** Absolute path inside the container. */
  container: string;
}

export interface ProjectConfig {
  name?: string;
  /** SSH alias of the deployment server. */
  server?: string;
  domain?: string;
  port?: number;
  data?: DataMount[];
}

/** PHP data mounts used when the existing config has none. */
export const PHP_DEFAULT_DATA: DataMount[] = [
  { host: 'uploads', container: '/var/www/html/uploads' },
  { host: 'logs', container: '/var/www/html/storage/logs' },
];

function checkString(config: Record<string, unknown>, field: string): void {
  const value = config[field];
  if (value !== undefined && (typeof value !== 'string' || value === '')) {
    throw new ConfigError(`${field} must be a string.`);
  }
}

function checkDataHost(raw: unknown, index: number): string {
  if (typeof raw !== 'string' || raw === '') {
    throw new ConfigError(`data[${index}].host must be a string.`);
  }
  // host paths must stay relative and inside ./data
  if (/^[a-zA-Z]:/.test(raw) || raw.startsWith('/') || raw.startsWith('\\') || raw.includes('\\')) {
    throw new ConfigError(`data[${index}].host must be a relative path without backslashes.`);
  }
  if (raw === '.' || raw === '..' || raw.split('/').some((segment) => segment === '..' || segment === '')) {
    throw new ConfigError(`data[${index}].host must not contain '..' or empty segments.`);
  }
  return raw;
}

function parseData(config: Record<string, unknown>): DataMount[] | undefined {
  const raw = config.data;
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new ConfigError('data must be a list of { host, container }.');
  const mounts: DataMount[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new ConfigError(`data[${index}] must be a mapping with host and container.`);
    }
    const record = entry as Record<string, unknown>;
    if (record.container === undefined) throw new ConfigError(`data[${index}].container is required.`);
    if (typeof record.container !== 'string' || !record.container.startsWith('/')) {
      throw new ConfigError(`data[${index}].container must be an absolute path starting with '/'.`);
    }
    const host = checkDataHost(record.host, index);
    if (seen.has(host)) throw new ConfigError(`data[${index}].host duplicates an earlier host: ${host}.`);
    seen.add(host);
    mounts.push({ host, container: record.container });
  });
  return mounts;
}

/**
 * Reads nad.project.yml from dir. Returns null when the file is missing;
 * throws ConfigError for invalid YAML or wrong types. Unknown keys are kept
 * out of the result and simply ignored.
 */
export async function loadConfig(dir: string): Promise<ProjectConfig | null> {
  const file = join(dir, 'nad.project.yml');
  if (!existsSync(file)) return null;
  let document: unknown;
  try {
    document = parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ConfigError(`invalid YAML.\n${(error as Error).message}`);
  }
  if (document === null || document === undefined) return {};
  if (typeof document !== 'object' || Array.isArray(document)) {
    throw new ConfigError('the file must be a YAML mapping.');
  }
  const config = document as Record<string, unknown>;
  checkString(config, 'name');
  checkString(config, 'server');
  checkString(config, 'domain');
  if (config.port !== undefined && (typeof config.port !== 'number' || !Number.isInteger(config.port))) {
    throw new ConfigError('port must be a number.');
  }
  return {
    name: config.name as string | undefined,
    server: config.server as string | undefined,
    domain: config.domain as string | undefined,
    port: config.port as number | undefined,
    data: parseData(config),
  };
}
