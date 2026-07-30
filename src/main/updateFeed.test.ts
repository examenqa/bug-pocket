import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PUBLIC_UPDATE_MANIFEST_URL,
  checkForUpdatesFromPublicFeed,
  parsePublicUpdateManifest,
  type FeedFetch
} from './updateFeed';

const validManifest = [
  'version: 1.0.0',
  'files:',
  '  - url: Bug-Pocket-Setup-1.0.0.exe',
  '    sha512: ' + 'A'.repeat(88),
  '    size: 123456',
  'path: Bug-Pocket-Setup-1.0.0.exe',
  'sha512: ' + 'A'.repeat(88),
  'releaseDate: 2026-07-30T00:00:00.000Z'
].join('\n');

test('an older installed build discovers a public update without credentials', async () => {
  let requestedUrl = '';
  let requestHeaders: HeadersInit | undefined;
  let updateChecks = 0;
  const fetchMock: FeedFetch = async (url, init) => {
    requestedUrl = url;
    requestHeaders = init.headers;
    return {
      ok: true,
      status: 200,
      text: async () => validManifest
    };
  };

  await checkForUpdatesFromPublicFeed({
    async checkForUpdatesAndNotify(): Promise<void> {
      updateChecks += 1;
    }
  }, fetchMock);

  assert.equal(requestedUrl, PUBLIC_UPDATE_MANIFEST_URL);
  assert.equal(updateChecks, 1);
  const serializedHeaders = JSON.stringify(requestHeaders).toLowerCase();
  assert.doesNotMatch(serializedHeaders, /authorization|token|credential|api.?key/);
});

test('a malformed latest.yml manifest is rejected before electron-updater runs', async () => {
  let updateChecks = 0;
  const fetchMock: FeedFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => 'version: not-semver\npath: ../../malicious.exe\nsha512: short'
  });

  await assert.rejects(
    () => checkForUpdatesFromPublicFeed({
      async checkForUpdatesAndNotify(): Promise<void> {
        updateChecks += 1;
      }
    }, fetchMock),
    /manifest is malformed/i
  );
  assert.equal(updateChecks, 0);
});

test('manifest parsing accepts electron-builder files entries and rejects missing hashes', () => {
  assert.deepEqual(parsePublicUpdateManifest(validManifest), {
    version: '1.0.0',
    path: 'Bug-Pocket-Setup-1.0.0.exe',
    sha512: 'A'.repeat(88)
  });
  assert.throws(
    () => parsePublicUpdateManifest('version: 1.0.0\npath: Bug-Pocket-Setup-1.0.0.exe'),
    /manifest is malformed/i
  );
});
