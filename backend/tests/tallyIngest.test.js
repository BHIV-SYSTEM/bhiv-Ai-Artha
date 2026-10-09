/**
 * tallyIngest.test — HMAC verification + ingestion with mocked mongoose.
 */
// Jest globals (describe/it/expect/jest/beforeAll/afterAll) - this suite
// used to import from 'vitest', which is not a dependency, so it never ran.
import http from 'node:http';
import crypto from 'node:crypto';

// ─── Mock mongoose entirely to prevent any real DB connections ──────
const mockUpsert = jest.fn(() => Promise.resolve({}));
const mockFindChain = jest.fn(() => ({ sort: () => ({ limit: () => ({ lean: () => Promise.resolve([]) }) }) }));

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  const mg = actual.default || actual;
  // Chainable null-query: awaitable AND supports .lean()/.sort()/.limit()…
  const makeQuery = () => {
    const promise = Promise.resolve(null);
    const q = {
      lean: () => promise,
      sort: () => q,
      limit: () => q,
      select: () => q,
      session: () => q,
      populate: () => q,
      then: (onF, onR) => promise.then(onF, onR),
      catch: (onR) => promise.catch(onR),
    };
    return q;
  };
  const fakeModel = jest.fn(() => ({
    findOne: () => makeQuery(),
    findById: () => makeQuery(),
    findOneAndUpdate: () => Promise.resolve({}),
    find: () => makeQuery(),
    countDocuments: jest.fn(() => Promise.resolve(1)),
    deleteMany: jest.fn(() => Promise.resolve({})),
    create: () => Promise.resolve({}),
  }));
  // Explicit shape only: copying mongoose's own object fails (read-only
  // props like `plugins` throw on Object.assign / object spread getters).
  const mocked = {
    Schema: mg.Schema,
    SchemaTypes: mg.Schema ? mg.Schema.Types : mg.Types,
    Types: mg.Types,
    model: fakeModel,
    models: {},
    connect: jest.fn(() => Promise.resolve()),
    connection: { close: jest.fn(() => Promise.resolve()), readyState: 1 },
    startSession: jest.fn(() => ({
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      abortTransaction: jest.fn(),
      endSession: jest.fn(),
    })),
  };
  return { __esModule: true, default: mocked, ...mocked };
});


jest.mock('../src/models/TallyParty.js', () => ({ __esModule: true, default: { findOneAndUpdate: mockUpsert, find: mockFindChain, countDocuments: jest.fn(() => Promise.resolve(1)), deleteMany: jest.fn(() => Promise.resolve({})) } }));
jest.mock('../src/models/TallyOutstanding.js', () => ({
  __esModule: true,
  default: {
    findOneAndUpdate: mockUpsert,
    find: mockFindChain,
    countDocuments: jest.fn(() => Promise.resolve(1)),
    deleteMany: jest.fn(() => Promise.resolve({})),
    // The controller derives BILL_TYPES from the schema at load time
    // (tallyIngest.controller.js:130) — mirror the real model's enum.
    schema: {
      path: (name) => (name === 'billType'
        ? { enumValues: ['New', 'New Ref', 'Advance', 'Agst Ref', 'On Account', 'Credit', 'Dr', 'Cr', 'Bill', 'Sales Bill', 'Purchase Bill', 'Debit Note', 'Credit Note', 'UNKNOWN'] }
        : undefined),
    },
  },
}));
jest.mock('../src/models/TallyVoucher.js', () => ({ __esModule: true, default: { findOneAndUpdate: mockUpsert, find: mockFindChain, countDocuments: jest.fn(() => Promise.resolve(1)), deleteMany: jest.fn(() => Promise.resolve({})) } }));
jest.mock('../src/models/TallySyncRun.js', () => ({ __esModule: true, default: { findOneAndUpdate: mockUpsert, find: mockFindChain, deleteMany: jest.fn(() => Promise.resolve({})) } }));

// ─── Helpers ───────────────────────────────────────────────────────
const sha256 = (d) => crypto.createHash('sha256').update(typeof d === 'string' ? d : JSON.stringify(d)).digest('hex');
const hmacSig = (s, m) => crypto.createHmac('sha256', s).update(m).digest('hex');

const KEY = 'k', SECRET = 's';
let server, base;

// Loaded in beforeAll: top-level `await import` is not parseable by babel-jest.
let verifyIngestAuth, ingest, ingestStatus;

beforeAll(async () => {
  ({ verifyIngestAuth, ingest, ingestStatus } = await import('../src/controllers/tallyIngest.controller.js'));
  process.env.TALLY_CONNECTOR_API_KEY = KEY;
  process.env.TALLY_CONNECTOR_HMAC_SECRET = SECRET;
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.post('/i', verifyIngestAuth, ingest);
  app.get('/i/status', ingestStatus);
  await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
});
afterAll(() => server?.close());

const mk = (et = 'party') => ({
  traceId: 't1', tenantId: 't1', company: 'BC', totalRecords: 1,
  records: [{ entity_type: et, tenant_id: 't1', company: 'BC', source_connector: 'tally', read_only: true,
    canonical_data: { party_id: 'X', party_name: 'X', group: 'Debtors' },
    schema_version: '1.0.0', source_system: 'agent', fetched_at: new Date().toISOString(),
    idempotency_key: 'k1', content_hash: 'h1' }],
});

function post(body, h = {}) {
  return new Promise((ok, no) => {
    const u = new URL('/i', base);
    const r = http.request(u, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { ok({ s: res.statusCode, b: JSON.parse(d) }); } catch { ok({ s: res.statusCode, b: d }); } });
    });
    r.on('error', no);
    r.write(JSON.stringify(body));
    r.end();
  });
}

function get(p) {
  return new Promise((ok, no) => {
    http.get(new URL(p, base), res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { ok({ s: res.statusCode, b: JSON.parse(d) }); } catch { ok({ s: res.statusCode, b: d }); } });
    }).on('error', no);
  });
}

function sign(body) {
  const h = sha256(JSON.stringify(body));
  return { h, sig: hmacSig(SECRET, h) };
}

describe('HMAC', () => {
  it('rejects no headers', async () => { expect((await post(mk(), {})).s).toBe(401); });
  it('rejects bad key', async () => { const { h, sig } = sign(mk()); expect((await post(mk(), { 'X-API-Key': 'x', 'X-Signature': sig, 'X-Content-Hash': h })).s).toBe(401); });
  it('rejects bad sig', async () => { const { h } = sign(mk()); expect((await post(mk(), { 'X-API-Key': KEY, 'X-Signature': 'aa'.repeat(32), 'X-Content-Hash': h })).s).toBe(403); });
  it('rejects bad hash', async () => { const { h, sig } = sign(mk()); expect((await post(mk(), { 'X-API-Key': KEY, 'X-Signature': sig, 'X-Content-Hash': '00'.repeat(32) })).s).toBe(403); });
});

describe('Ingest', () => {
  it('upserts on valid payload', async () => {
    mockUpsert.mockClear();
    const p = mk();
    const { h, sig } = sign(p);
    const r = await post(p, { 'X-API-Key': KEY, 'X-Signature': sig, 'X-Content-Hash': h });
    expect(r.s).toBe(200);
    expect(r.b.success).toBe(true);
    expect(r.b.counts.parties).toBe(1);
    expect(mockUpsert).toHaveBeenCalled();
  });

  it('status endpoint', async () => {
    const r = await get('/i/status?tenant_id=t1');
    expect(r.s).toBe(200);
    expect(r.b.runs).toBeDefined();
  });
});