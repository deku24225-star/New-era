import assert from 'node:assert/strict';
import { onRequestGet as health } from '../functions/api/health.js';
import { onRequestPost as chat } from '../functions/api/chat.js';
import { onRequestPost as search } from '../functions/api/search.js';

const accessToken = 'local-test-access-token-only';
const env = {
  JARVIS_ACCESS_TOKEN: accessToken,
  GEMINI_API_KEY: 'mock-gemini-key',
  GEMINI_MODEL: 'gemini-2.5-flash',
  TAVILY_API_KEY: 'mock-tavily-key',
  OPENROUTER_API_KEY: 'mock-openrouter-key',
  OPENROUTER_MODEL: 'mock/provider',
};
const baseHeaders = {
  'Origin': 'https://jarvis.test',
  'Authorization': `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
};
function request(path, { body, headers = {}, method = body === undefined ? 'GET' : 'POST' } = {}) {
  return new Request(`https://jarvis.test${path}`, {
    method,
    headers: { ...baseHeaders, ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}
async function body(response) { return response.json(); }
let assertions = 0;
function check(value, message) { assert.ok(value, message); assertions++; }
function equal(actual, expected, message) { assert.equal(actual, expected, message); assertions++; }

// Health must not reveal configuration without the access token.
{
  const res = await health({ request: request('/api/health', { headers: { Authorization: '' } }), env });
  equal(res.status, 401, 'health rejects missing token');
  const ok = await health({ request: request('/api/health'), env });
  equal(ok.status, 200, 'health accepts correct token');
  const data = await body(ok);
  check(data.providers.gemini && data.providers.tavily, 'health reports provider configuration');
}

// Origin checks reject another origin before touching provider APIs.
{
  const res = await chat({ request: request('/api/chat', { headers: { Origin: 'https://attacker.test', 'CF-Connecting-IP': 'origin-test' }, body: { messages: [{ role: 'user', content: 'Hi' }] } }), env });
  equal(res.status, 403, 'chat rejects foreign origin');
}

// Request body validation enforces its byte limit even without Content-Length.
{
  const res = await chat({ request: request('/api/chat', { headers: { 'CF-Connecting-IP': 'oversize-test' }, body: { messages: [{ role: 'user', content: 'x'.repeat(34_000) }] } }), env });
  equal(res.status, 413, 'chat rejects oversized body');
  const invalid = await search({ request: request('/api/search', { headers: { 'CF-Connecting-IP': 'invalid-json-test' }, body: '{not-json' }), env });
  equal(invalid.status, 400, 'search rejects invalid JSON');
}

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url, options) => {
    check(String(url).includes('generativelanguage.googleapis.com'), 'chat calls Gemini endpoint');
    const sent = JSON.parse(options.body);
    check(sent.contents.some(item => item.role === 'user'), 'Gemini receives user role');
    check(sent.contents.some(item => item.role === 'model'), 'Gemini receives assistant history as model role');
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hello from mocked Gemini.' }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const res = await chat({ request: request('/api/chat', { headers: { 'CF-Connecting-IP': 'chat-success-test' }, body: { messages: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi there' }, { role: 'user', content: 'Continue' }] } }), env });
  equal(res.status, 200, 'chat returns success for mock Gemini');
  equal((await body(res)).reply, 'Hello from mocked Gemini.', 'chat returns mocked reply');

  globalThis.fetch = async url => {
    check(String(url).includes('api.tavily.com/search'), 'search calls Tavily endpoint');
    return new Response(JSON.stringify({ results: [
      { title: 'Safe result', url: 'https://example.com/article', content: 'Snippet' },
      { title: 'Bad URL', url: 'javascript:alert(1)', content: 'Must be removed' },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const searchRes = await search({ request: request('/api/search', { headers: { 'CF-Connecting-IP': 'search-success-test' }, body: { query: 'test query' } }), env });
  equal(searchRes.status, 200, 'search returns success for mock Tavily');
  const searchData = await body(searchRes);
  equal(searchData.results.length, 1, 'search filters unsafe URL schemes');
  equal(searchData.results[0].url, 'https://example.com/article', 'search keeps HTTP(S) result');

  globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  let last;
  for (let i = 0; i < 16; i++) {
    last = await chat({ request: request('/api/chat', { headers: { 'CF-Connecting-IP': 'rate-limit-test' }, body: { messages: [{ role: 'user', content: 'Hello' }] } }), env });
  }
  equal(last.status, 429, 'best-effort chat rate limit returns 429 after threshold');
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`PASS: ${assertions} smoke assertions; API success paths used mocked provider responses only.`);
