import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeByokBaseUrl } from './byokEndpoint';

test('preserves HTTPS provider paths and normalizes whitespace and trailing slashes', () => {
  assert.equal(normalizeByokBaseUrl(' https://example.test/api/v1/// '), 'https://example.test/api/v1');
  assert.equal(normalizeByokBaseUrl('https://generativelanguage.googleapis.com/v1beta/openai'), 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(normalizeByokBaseUrl(''), '');
});

test('permits HTTP only on loopback hosts used by local AI servers', () => {
  for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '127.0.0.2', '[::1]']) {
    assert.doesNotThrow(() => normalizeByokBaseUrl(`http://${host}:11434/v1`));
  }
});

test('rejects remote HTTP, private networks, misleading hostnames and unsupported schemes', () => {
  for (const endpoint of [
    'http://example.test/v1', 'http://192.168.1.10/v1', 'http://10.0.0.1/v1',
    'http://localhost.example.test/v1', 'http://127.0.0.1.example.test/v1',
    'http://[::]/v1', 'ftp://localhost/v1', 'file:///tmp/ai', 'not a URL'
  ]) {
    assert.throws(() => normalizeByokBaseUrl(endpoint), /must use HTTPS/);
  }
});

test('rejects URL credentials and query/fragment secrets without repeating them in errors', () => {
  for (const endpoint of [
    'https://user:secret@example.test/v1', 'http://user:secret@localhost/v1',
    'https://@example.test/v1',
    'https://example.test/v1?key=secret', 'https://example.test/v1#secret',
    'https://example.test/v1?', 'https://example.test/v1#'
  ]) {
    assert.throws(() => normalizeByokBaseUrl(endpoint), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    });
  }
});

test('rejects malformed endpoint forms instead of silently repairing them', () => {
  for (const endpoint of [
    'https:example.test/v1', 'https:/example.test/v1', 'https:///example.test/v1',
    'http:localhost:11434/v1', '//example.test/v1',
    'https://exa\nmple.test/v1', 'https://example.test/\tv1',
    'https://example.test/ v1', 'https://example.test\\v1',
    'https://example.test/\u0000v1', 'https://example.test/\u007fv1'
  ]) {
    assert.throws(() => normalizeByokBaseUrl(endpoint), /must use HTTPS/);
  }
});
