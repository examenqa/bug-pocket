import { JSON_SCHEMA, load } from 'js-yaml';

export const PUBLIC_UPDATE_FEED_URL = 'https://bug-pocket-updates-v1.s3.ap-south-1.amazonaws.com/windows';
export const PUBLIC_UPDATE_MANIFEST_URL = PUBLIC_UPDATE_FEED_URL + '/latest.yml';

export interface PublicUpdateManifest {
  version: string;
  path: string;
  sha512: string;
}

type FeedFetchResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

export type FeedFetch = (url: string, init: RequestInit) => Promise<FeedFetchResponse>;

export interface UpdateCheckPort {
  checkForUpdatesAndNotify(): Promise<unknown>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function isValidVersion(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value.trim());
}

function isSafeInstallerPath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 4
    && value.length <= 255
    && !value.includes('/')
    && !value.includes('\\')
    && !value.includes('..')
    && value.toLowerCase().endsWith('.exe');
}

function isValidSha512(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 80
    && value.length <= 128
    && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export function parsePublicUpdateManifest(source: string): PublicUpdateManifest {
  let parsed: unknown;
  try {
    parsed = load(source, { schema: JSON_SCHEMA });
  } catch {
    throw new Error('The update manifest is malformed.');
  }

  if (!isPlainRecord(parsed) || !isValidVersion(parsed.version)) {
    throw new Error('The update manifest is malformed.');
  }

  let path = parsed.path;
  let sha512 = parsed.sha512;
  if ((!path || !sha512) && Array.isArray(parsed.files) && isPlainRecord(parsed.files[0])) {
    path = parsed.files[0].url;
    sha512 = parsed.files[0].sha512;
  }

  if (!isSafeInstallerPath(path) || !isValidSha512(sha512)) {
    throw new Error('The update manifest is malformed.');
  }

  return {
    version: parsed.version.trim(),
    path,
    sha512
  };
}

export async function readPublicUpdateManifest(
  fetchImpl: FeedFetch = (url, init) => fetch(url, init)
): Promise<PublicUpdateManifest> {
  const response = await fetchImpl(PUBLIC_UPDATE_MANIFEST_URL, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/yaml, text/yaml, text/plain'
    }
  });

  if (!response.ok) {
    throw new Error('The public update feed returned HTTP ' + response.status + '.');
  }

  return parsePublicUpdateManifest(await response.text());
}

export async function checkForUpdatesFromPublicFeed(
  updater: UpdateCheckPort,
  fetchImpl?: FeedFetch
): Promise<unknown> {
  await readPublicUpdateManifest(fetchImpl);
  return updater.checkForUpdatesAndNotify();
}
