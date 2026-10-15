/**
 * Generic receivables / "list of outstanding due" report parser (pure).
 *
 * Works from the PDF's own layout (text items clustered into rows by their
 * y-coordinate, columns discovered from the table's header labels) so nothing
 * about a specific report — column positions, customer names, amounts, day
 * counts — is ever hard-coded. Any tabular report whose header carries
 * date / reference / amount / due / days-style columns parses with this.
 *
 * Kept free of Node-only dependencies (pdfjs, mongoose, logger) so it can be
 * unit-tested directly. Layout extraction and persistence live in
 * `receivables.service.js`.
 */

/* ── primitives ─────────────────────────────────────────────────── */

const NUM = /^-?\d{1,3}(,\d{2,3})*(\.\d+)?$|^-?\d+(\.\d+)?$/;

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/** Parse "23 Mar 26" / "07 May 26" style dates (2-digit year → 20xx). */
export function parseReportDate(s) {
  const m = String(s).trim().match(/^(\d{1,2})\s+([A-Za-z]{3,4})\s+(\d{2,4})$/);
  if (!m) return null;
  const mo = MONTHS[m[2].toLowerCase()];
  if (mo === undefined) return null;
  let y = +m[3];
  if (y < 100) y += 2000;
  return new Date(Date.UTC(y, mo, +m[1]));
}

/** Parse Indian-format numbers: "11,49,012" → 1149012, "-1" → -1. */
export const parseAmount = (s) => {
  const v = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
};

export const bucketOf = (days) =>
  days == null || days <= 0 ? 'current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';

export const AGING_BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'];

/* ── header role detection (position-independent) ───────────────── */

const ROLES = [
  ['date', /date/i],
  ['ref', /ref\b|ref\.|invoice|bill|voucher|doc/i],
  ['amount', /pending|amount|value|balance|outstanding/i],
  ['due', /due/i],
  ['days', /day|overdue|age/i],
];

/**
 * Detect a table header row from its labels. Returns { role: {x, label} }
 * when at least 4 roles (incl. date + amount) are present, else null.
 */
export function detectHeader(row) {
  const found = {};
  for (const cell of row) {
    const t = cell.s.trim();
    if (!t) continue;
    for (const [role, re] of ROLES) {
      if (found[role]) continue;
      if (re.test(t) && !Object.values(found).some((c) => c.x === cell.x)) {
        found[role] = { x: cell.x, label: t };
        break;
      }
    }
  }
  if (Object.keys(found).length >= 4 && found.date && found.amount) return found;
  return null;
}

/* ── the parser ─────────────────────────────────────────────────── */

const isNoise = (row) =>
  row.some((c) => /bizanalyst|created by|sent through|https?:\/\/|^Page \d/i.test(c.s.trim()));

const isTotalRow = (row) =>
  row.some((c) => /^total$/i.test(c.s.trim())) &&
  row.some((c) => NUM.test(c.s.trim()) && c.s.trim().toLowerCase() !== 'total');

/**
 * Parse layout rows into a structured receivables report.
 *
 * @param {Array<Array<{x:number,s:string}>>} rows
 * @returns {{title, group, asOfDate, declared, customers, integrity, aging} | null}
 *   null when no recognizable table header exists (not a receivables report).
 */
export function parseReceivables(rows) {
  let cols = null;
  let cur = null;
  let group = null;
  let title = null;
  let pendingName = [];
  const customers = [];
  const declared = { customers: null, amount: null };
  const stats = { headers: 0, bills: 0, skipped: 0 };

  for (const row of rows) {
    const text = row.map((c) => c.s).join(' ').replace(/\s+/g, ' ').trim();
    if (isNoise(row)) continue;

    if (!title && /^list of /i.test(text)) { title = text; continue; }
    let m = text.match(/^Total Customers\s*:\s*([\d,]+)/i);
    if (m) { declared.customers = parseAmount(m[1]); continue; }
    m = text.match(/^Total Amount\s*:\s*([\d,]+(?:\.\d+)?)/i);
    if (m) { declared.amount = parseAmount(m[1]); continue; }
    m = text.match(/^Group\s*:\s*(.+)/i);
    if (m) { group = m[1].trim(); continue; }

    const hdr = detectHeader(row);
    if (hdr) {
      stats.headers++;
      cols = Object.fromEntries(Object.entries(hdr).map(([k, v]) => [k, v.x]));
      cur = {
        name: pendingName.join(' ').replace(/\s+/g, ' ').trim(),
        group,
        bills: [],
        statedTotal: null,
      };
      pendingName = [];
      continue;
    }

    if (isTotalRow(row)) {
      const amtCell = row.find((c) => NUM.test(c.s.trim()) && c.s.trim().toLowerCase() !== 'total');
      if (cur) {
        cur.statedTotal = amtCell ? parseAmount(amtCell.s) : null;
        customers.push(cur);
        cur = null;
      }
      pendingName = [];
      continue;
    }

    if (cur && cols) {
      // Snap each cell to its nearest header column.
      const at = {};
      for (const c of row) {
        let best = null;
        let bd = 1e9;
        for (const [role, x] of Object.entries(cols)) {
          const d = Math.abs(c.x - x);
          if (d < bd) { bd = d; best = role; }
        }
        if (bd <= 45 && !(best in at)) at[best] = c.s.trim();
      }
      const bill = {
        date: at.date ? parseReportDate(at.date) : null,
        dueDate: at.due ? parseReportDate(at.due) : null,
        ref: at.ref || null,
        amount: at.amount && NUM.test(at.amount) ? parseAmount(at.amount) : null,
        daysOverdue: at.days && /^\d{1,4}$/.test(at.days) ? parseInt(at.days, 10) : null,
      };
      // Header continuation ("Amount" / "by days" second line) carries no data.
      if (bill.amount === null && !bill.date && !bill.ref) { stats.skipped++; continue; }
      stats.bills++;
      cur.bills.push(bill);
      continue;
    }

    pendingName.push(text);
  }

  if (!stats.headers || !customers.length) return null;

  /* ── derive as-of date from the data itself (dueDate + daysOverdue) ── */
  const asOfVotes = {};
  const allBills = customers.flatMap((c) => c.bills);
  for (const b of allBills) {
    if (b.daysOverdue > 0 && b.dueDate) {
      const k = new Date(b.dueDate.getTime() + b.daysOverdue * 86400000).toISOString().slice(0, 10);
      asOfVotes[k] = (asOfVotes[k] || 0) + 1;
    }
  }
  const asOfEntry = Object.entries(asOfVotes).sort((a, b) => b[1] - a[1])[0];
  const asOfDate = asOfEntry ? new Date(`${asOfEntry[0]}T00:00:00Z`) : null;

  // Not-yet-due rows have no printed day count — age them against as-of date.
  const effectiveAsOf = asOfDate || new Date();
  for (const b of allBills) {
    if (b.daysOverdue == null) {
      b.daysOverdue = b.dueDate
        ? Math.max(0, Math.floor((effectiveAsOf - b.dueDate) / 86400000))
        : 0;
    }
  }

  /* ── aging roll-ups ─────────────────────────────────────────────── */
  const aging = Object.fromEntries(AGING_BUCKETS.map((k) => [k, 0]));
  for (const c of customers) {
    c.aging = Object.fromEntries(AGING_BUCKETS.map((k) => [k, 0]));
    c.computedTotal = 0;
    for (const b of c.bills) {
      const bk = bucketOf(b.daysOverdue);
      b.bucket = bk;
      const amt = b.amount || 0;
      aging[bk] += amt;
      c.aging[bk] += amt;
      c.computedTotal += amt;
    }
  }

  /* ── integrity checks ───────────────────────────────────────────── */
  const computedTotal = customers.reduce((s, c) => s + c.computedTotal, 0);
  const mismatches = customers.filter(
    (c) => c.statedTotal != null && Math.abs(c.computedTotal - c.statedTotal) > 0.05
  );
  const integrity = {
    declaredCustomers: declared.customers,
    parsedCustomers: customers.length,
    customersMatch: declared.customers == null ? null : declared.customers === customers.length,
    declaredTotal: declared.amount,
    computedTotal: Math.round(computedTotal * 100) / 100,
    totalMatches: declared.amount == null ? null : Math.abs(computedTotal - declared.amount) <= 0.05,
    customerTotalMismatches: mismatches.length,
    mismatchedCustomers: mismatches.slice(0, 10).map((c) => c.name),
    billCount: allBills.length,
  };

  return {
    title: title || 'List of outstanding due.',
    group,
    asOfDate,
    declared,
    customers,
    aging: Object.fromEntries(Object.entries(aging).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    integrity,
    stats,
  };
}

/* ── quick text sniff (for smart-upload type detection) ─────────── */

/** Cheap content check: does this text look like an outstanding-due report? */
export function looksLikeReceivablesReport(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return false;
  const signals = [
    'list of outstanding due',
    'total customers',
    'overdue',
    'due on',
    'pending amount',
    'by days',
  ];
  const score = signals.reduce((s, kw) => s + (t.includes(kw) ? 1 : 0), 0);
  return score >= 3;
}
