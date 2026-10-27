export {};

const test: typeof import('node:test') = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const { createServer }: typeof import('node:http') = require('node:http');
const { once }: typeof import('node:events') = require('node:events');
const { triageBugWithOllama }: typeof import('./ollamaTriage') = require('./ollamaTriage.ts');

for (const status of [307, 308]) {
  test(`local Ollama does not forward bug text or screenshots through HTTP ${status}`, async () => {
    const originalFetch = globalThis.fetch;
    let initialRequests = 0;
    let redirectedRequests = 0;
    let receivedBody = '';
    const server = createServer(async (request, response) => {
      if (request.url === '/api/chat') {
        initialRequests += 1;
        for await (const chunk of request) receivedBody += chunk.toString();
        response.writeHead(status, { Location: '/redirected' });
      } else {
        redirectedRequests += 1;
        response.writeHead(200, { 'content-type': 'application/json' });
      }
      response.end(JSON.stringify({ message: { content: '{}' } }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      // Exercise the real fetch redirect handling on a disposable port without
      // connecting to, or replacing, a user's local Ollama service on port 11434.
      globalThis.fetch = ((input, init) => {
        assert.equal(input, 'http://localhost:11434/api/chat');
        return originalFetch(`http://127.0.0.1:${address.port}/api/chat`, init);
      }) as typeof fetch;

      const result = await triageBugWithOllama(
        { note: 'private bug report' },
        'local-model',
        'data:image/jpeg;base64,dGVzdA=='
      );
      assert.equal(result.success, false);
      assert.equal(initialRequests, 1);
      assert.match(receivedBody, /private bug report/);
      assert.match(receivedBody, /dGVzdA==/);
      assert.equal(redirectedRequests, 0);
    } finally {
      globalThis.fetch = originalFetch;
      const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closed;
    }
  });
}
