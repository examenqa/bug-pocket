import assert from 'node:assert/strict';
import test from 'node:test';
import { parseErrorForUI } from './errors';

test('preserves IPC validation details instead of showing provider outage text', () => {
  const message = parseErrorForUI(new TypeError('Invalid IPC payload at arguments[0].environment: expected a short string.'));

  assert.match(message, /Invalid IPC payload/);
  assert.match(message, /environment/);
  assert.doesNotMatch(message, /AI Provider is currently overloaded or down/);
});

test('preserves serialized IPC validation details', () => {
  const message = parseErrorForUI({ message: 'Validation failed: Environment missing.' });

  assert.match(message, /Environment missing/);
  assert.doesNotMatch(message, /AI Provider is currently overloaded or down/);
});

test('uses the outage message for explicit HTTP 503 responses', () => {
  assert.equal(
    parseErrorForUI(new Error('AI Provider Error: HTTP 503: service unavailable')),
    'AI Provider is currently overloaded or down. Try again later.'
  );
});

test('uses the outage message for fetch failures', () => {
  assert.equal(
    parseErrorForUI(new Error('fetch failed')),
    'AI Provider is currently overloaded or down. Try again later.'
  );
});

test('does not classify unrelated provider errors as an outage', () => {
  const message = parseErrorForUI(new Error('AI Provider returned HTTP 404: model not found'));

  assert.match(message, /HTTP 404/);
  assert.doesNotMatch(message, /AI Provider is currently overloaded or down/);
});
