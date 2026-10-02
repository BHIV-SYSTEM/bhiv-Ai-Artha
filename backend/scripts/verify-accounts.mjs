import { createHash, createHmac } from 'node:crypto';

const BASE = 'http://localhost:5000/api/v1';
const LEGACY_KEY = '404bc199ce6e26faf308aaa51bb48981315cd8b33e62900491f3e9ec72275ace';
const LEGACY_SECRET = 'f139954315d71e02226d1d26d629a68902a38ddc0666161ceac1c55423dccf3b';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const hmac = (s, m) => createHmac('sha256', s).update(m).digest('hex');

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
};

async function login(email, password) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => ({}));
  return {
    ok: r.ok && j.success,
    cookie: (r.headers.get('set-cookie') || '').split(';')[0],
    user: j.data?.user || j.user || null,
    status: r.status,
  };
}

async function ingest(credentials, payloadObj) {
  const body = JSON.stringify(payloadObj);
  const hash = sha256(body);
  const r = await fetch(`${BASE}/tally-connect/ingest`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': credentials.key,
      'x-content-hash': hash,
      'x-signature': hmac(credentials.secret, hash),
    },
    body,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

const mkPayload = (tag, voucherNum) => ({
  traceId: `${tag}-${Date.now()}`,
  tenantId: 'tenant_bright_connection_001',
  company: `Verify Co ${tag}`,
  totalRecords: 1,
  records: [{
    entity_type: 'voucher',
    canonical_data: {
      voucher_type: 'Sales', voucher_number: voucherNum, date: '2026-09-20',
      party_name: `${tag} Customer`, amount: '11800', narration: `verify ${tag}`,
      gst_details: { taxable_value: 10000, cgst: '900', sgst: '900', igst: 0 },
      entries: [],
    },
    idempotency_key: `${tag}-${voucherNum}-1`,
    fetched_at: new Date().toISOString(),
    schema_version: '1.0',
    content_hash: 'local',
  }],
});

const ok201or409 = (st) => st === 201 || st === 409; // 409 = account exists from a previous run

// ---------- 1. owner login ----------
const owner = await login('admin@artha.local', 'Admin@123456');
check('1. owner admin login', owner.ok, `status=${owner.status}`);
const oAuth = { cookie: owner.cookie, 'content-type': 'application/json' };

// ---------- 2. owner connector credentials ----------
let r = await fetch(`${BASE}/tally-connect/credentials`, { headers: oAuth });
let j = await r.json();
check('2. owner GET credentials issued', r.ok && !!j.data?.apiKey, `key=${(j.data?.apiKey || '').slice(0, 8)}…`);
const K1 = { key: j.data.apiKey, secret: j.data.hmacSecret };
check('2b. credentials show cloudUrl', !!j.data?.cloudUrl, j.data?.cloudUrl);

// ---------- 3. create company (reuse if it already exists) ----------
const COMPANY_NAME = 'Acme Traders (Verify)';
r = await fetch(`${BASE}/multi-company/companies`, {
  method: 'POST', headers: oAuth,
  body: JSON.stringify({ name: COMPANY_NAME }),
});
j = await r.json();
let companyId = j.data?._id || j.data?.id;
if (!companyId) {
  const list = await (await fetch(`${BASE}/multi-company/companies`, { headers: oAuth })).json();
  companyId = (list.data || []).find((c) => c.name === COMPANY_NAME)?._id;
}
check('3. company Acme Traders exists', !!companyId, `companyId=${companyId || JSON.stringify(j).slice(0, 120)}`);

// ---------- 4. create sub-admin (company-bound) ----------
r = await fetch(`${BASE}/users`, {
  method: 'POST', headers: oAuth,
  body: JSON.stringify({ name: 'Acme Sub Admin', email: 'subadmin@acme.local', role: 'sub_admin', password: 'SubAdmin@123456', companyId }),
});
check('4. sub_admin exists (created or already present)', ok201or409(r.status), `status=${r.status}`);

// ---------- 5. create accountant + viewer ----------
r = await fetch(`${BASE}/users`, {
  method: 'POST', headers: oAuth,
  body: JSON.stringify({ name: 'Book Keeper', email: 'accountant@verify.local', role: 'accountant', password: 'Accountant@123456' }),
});
check('5. accountant exists', ok201or409(r.status), `status=${r.status}`);
r = await fetch(`${BASE}/users`, {
  method: 'POST', headers: oAuth,
  body: JSON.stringify({ name: 'Read Only', email: 'viewer@verify.local', role: 'viewer', password: 'Viewer@123456' }),
});
check('5b. viewer exists', ok201or409(r.status), `status=${r.status}`);

// ---------- 6. second admin rejected ----------
r = await fetch(`${BASE}/users`, {
  method: 'POST', headers: oAuth,
  body: JSON.stringify({ name: 'Another Admin', email: 'admin2@artha.local', role: 'admin', password: 'Admin2@123456' }),
});
j = await r.json();
check('6. creating a 2nd admin is BLOCKED', r.status === 403, `status=${r.status} msg=${j.message || ''}`);

// ---------- 7. sub-admin login + credentials ----------
const sub = await login('subadmin@acme.local', 'SubAdmin@123456');
check('7. sub-admin login', sub.ok, `status=${sub.status}`);
const sAuth = { cookie: sub.cookie, 'content-type': 'application/json' };
r = await fetch(`${BASE}/tally-connect/credentials`, { headers: sAuth });
j = await r.json();
check('7b. sub-admin GET credentials', r.ok && !!j.data?.apiKey, `key=${(j.data?.apiKey || '').slice(0, 8)}…`);
const K2 = { key: j.data?.apiKey, secret: j.data?.hmacSecret };

// ---------- 8. accountant gets 403 on credentials ----------
const acc = await login('accountant@verify.local', 'Accountant@123456');
check('8. accountant login', acc.ok, `status=${acc.status}`);
r = await fetch(`${BASE}/tally-connect/credentials`, { headers: { cookie: acc.cookie, 'content-type': 'application/json' } });
check('8b. accountant credentials = 403', r.status === 403, `status=${r.status}`);

// ---------- 9. ingest same voucher number via BOTH keys (unique per run) ----------
const RUN = Date.now().toString(36).toUpperCase();
const SAME_NUM = `VERIFY-SAME-${RUN}`;
const res1 = await ingest(K1, mkPayload('owner', SAME_NUM));
check('9. ingest with OWNER key', res1.status === 200 && res1.json.bridge?.sales === 1, JSON.stringify(res1.json.bridge || res1.json).slice(0, 140));
const res2 = await ingest(K2, mkPayload('acme', SAME_NUM));
check('9b. ingest SAME voucher # with SUB-ADMIN key (no unique-index clash)', res2.status === 200 && res2.json.bridge?.sales === 1, JSON.stringify(res2.json.bridge || res2.json).slice(0, 140));

// ---------- 10. isolation: each sees only their own ----------
r = await fetch(`${BASE}/tally-connect/vouchers?limit=200`, { headers: oAuth });
const ownerVouchers = (await r.json()).data || [];
r = await fetch(`${BASE}/tally-connect/vouchers?limit=200`, { headers: sAuth });
const subVouchers = (await r.json()).data || [];
const ownerHasOwn = ownerVouchers.some(v => v.voucherNumber === SAME_NUM && (v.partyName || '').startsWith('owner'));
const ownerHasAcme = ownerVouchers.some(v => v.voucherNumber === SAME_NUM && (v.partyName || '').startsWith('acme'));
const subHasAcme = subVouchers.some(v => v.voucherNumber === SAME_NUM && (v.partyName || '').startsWith('acme'));
const subHasOwn = subVouchers.some(v => v.voucherNumber === SAME_NUM && (v.partyName || '').startsWith('owner'));
check('10. owner sees OWN voucher', ownerHasOwn, `total=${ownerVouchers.length}`);
check('10b. owner does NOT see acme voucher', !ownerHasAcme);
check('10c. sub-admin sees ACME voucher', subHasAcme, `total=${subVouchers.length}`);
check('10d. sub-admin does NOT see owner voucher', !subHasOwn);

// invoices isolation
r = await fetch(`${BASE}/invoices?limit=200`, { headers: oAuth });
const ownerInv = ((await r.json()).data || []).filter(i => i.invoiceNumber === SAME_NUM);
r = await fetch(`${BASE}/invoices?limit=200`, { headers: sAuth });
const subInv = ((await r.json()).data || []).filter(i => i.invoiceNumber === SAME_NUM);
check('10e. invoice isolated (distinct docs, same #, right owner)',
  ownerInv.length === 1 && subInv.length === 1 &&
  ownerInv[0]._id !== subInv[0]._id &&
  ownerInv[0].customerName === 'owner Customer' &&
  subInv[0].customerName === 'acme Customer',
  `owner=${ownerInv.length} sub=${subInv.length}`);

// ---------- 11. legacy key still works → owner workspace ----------
const LEG_NUM = `VERIFY-LEG-${RUN}`;
const res3 = await ingest({ key: LEGACY_KEY, secret: LEGACY_SECRET }, mkPayload('legacy', LEG_NUM));
check('11. legacy shared key accepted', res3.status === 200, `status=${res3.status}`);
r = await fetch(`${BASE}/tally-connect/vouchers?limit=200`, { headers: oAuth });
const ov2 = (await r.json()).data || [];
r = await fetch(`${BASE}/tally-connect/vouchers?limit=200`, { headers: sAuth });
const sv2 = (await r.json()).data || [];
check('11b. legacy push lands in OWNER workspace', ov2.some(v => v.voucherNumber === LEG_NUM) && !sv2.some(v => v.voucherNumber === LEG_NUM));

// ---------- 12. bad key rejected ----------
const res4 = await ingest({ key: 'deadbeef'.repeat(8), secret: LEGACY_SECRET }, mkPayload('bad', `VERIFY-BAD-${RUN}`));
check('12. unknown API key = 401', res4.status === 401, `status=${res4.status}`);

// ---------- 13. integrity: ledger chain ----------
r = await fetch(`${BASE}/ledger/verify`, { headers: oAuth });
j = await r.json();
check('13. ledger hash chain valid', j.data?.isValid === true, `entries=${j.data?.chainLength}`);

// ---------- 14. users listing: accountant sees? (admin-only route) ----------
r = await fetch(`${BASE}/users`, { headers: { cookie: acc.cookie, 'content-type': 'application/json' } });
check('14. accountant cannot list users (admin only)', r.status === 403, `status=${r.status}`);

console.log(`\nRESULT: ${fail === 0 ? `ALL ${pass} CHECKS PASSED` : `${pass} passed, ${fail} FAILED`}`);
process.exit(fail === 0 ? 0 : 1);
