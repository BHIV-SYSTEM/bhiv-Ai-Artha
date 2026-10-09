import logger from '../config/logger.js';

/**
 * Format-agnostic GST invoice parser.
 *
 * Indian invoices are printed as tables whose column ORDER changes from
 * printer to printer (a Tally "Amount, Rate, Qty" layout is not a Busy
 * "Qty, Rate, Amount" layout), and PDF text extraction flattens every cell
 * into one space-joined line — so column headers cannot be trusted to line up
 * with the values underneath them.
 *
 * This parser therefore never assumes an order. For every row it finds the
 * one arithmetic identity that always holds on an invoice line:
 *
 *     quantity x rate = line amount
 *
 * ...and then uses token structure (unit words such as KG/NOS, and whether the
 * product sits at the start or the end of the numeric run) to work out which
 * of the three numbers is which.
 */

const UNITS = new Set([
  'KG', 'KGS', 'GM', 'GMS', 'GRAM', 'GRAMS', 'ML', 'LTR', 'LTRS', 'LTS',
  'NOS', 'NO', 'PCS', 'BOX', 'BAG', 'PACK', 'DOZ', 'DOZEN', 'CTN',
  'CARTON', 'BTL', 'BOTTLE', 'JAR', 'TIN', 'PKT', 'POUCH', 'ROLL',
  'SET', 'PAIR', 'MTR', 'SQM', 'LTR.',
]);

/** Sub-strings that mark the end of an item row and the start of totals/footer. */
const ROW_TRIMS = [
  'continued', 'subject to', 'tax invoice', 'basic amt', 'cgst@', 'sgst@',
  'igst@', 'grand total', 'amount chargeable', 'material receiv',
  'narration', 'hsn/sac', 'sl description', 'declaration', 'tax analysis',
];

const NUMBER_TOKEN = /^[+-]?[\d,]*\.?\d+$/;
const HSN_TOKEN = /^\d{4,8}$/;
// `(?<![\d.])` stops the fractional part of a decimal (`1988.10 39762.00`)
// from being read as a serial number.
const ROW_START = /(?<![\d.])(\d{1,4})\s+(?=\S)/g;

const isUnit = (t) => typeof t === 'string' && /^[A-Z]{2,5}$/.test(t) && UNITS.has(t);
const isNumber = (t) => NUMBER_TOKEN.test(t) && /\d/.test(t);
const toNum = (t) => parseFloat(String(t).replace(/,/g, ''));

/** Drop alternate-unit annotations such as "(15,000.00 GRAM)" before parsing. */
const stripParenthesisedUnits = (text) =>
  text.replace(/\([^()]*\b(?:GRAM|GRAMS|GMS|KG|ML|LTR|LTRS|NOS|PCS|DOZEN)\b[^()]*\)/gi, ' ');

const trimRow = (s) => {
  const lower = s.toLowerCase();
  let cut = -1;
  for (const marker of ROW_TRIMS) {
    const i = lower.indexOf(marker);
    if (i !== -1 && (cut === -1 || i < cut)) cut = i;
  }
  return cut === -1 ? s : s.slice(0, cut);
};

class InvoiceParser {
  /**
   * @param {string} rawText full extracted document text
   * @returns {{items: Array, itemCount: number, subtotal: ?number,
   *            taxAmount: ?number, total: ?number, roundOff: ?number,
   *            source: Object}}
   */
  parse(rawText) {
    const empty = {
      items: [], itemCount: 0,
      subtotal: null, taxAmount: null, total: null, roundOff: null,
      source: { subtotal: null, total: null, tax: null },
    };

    if (!rawText || rawText.length < 40) return empty;

    const text = stripParenthesisedUnits(String(rawText));
    const rows = this._detectRows(text);
    if (!rows.length) return empty;

    const items = [];
    for (const row of rows) {
      const item = this._parseRow(row.text);
      if (item) items.push(item);
    }
    if (!items.length) return empty;

    const itemsSum = round2(items.reduce((s, i) => s + i.amount, 0));
    const totals = this._extractTotals(text, itemsSum);

    const result = {
      items,
      itemCount: items.length,
      subtotal: totals.subtotal ?? itemsSum,
      taxAmount: totals.taxAmount,
      total: totals.total,
      roundOff: totals.roundOff,
      source: totals.source,
    };

    // Cross-check: if the printed subtotal disagrees with what we read out of
    // the rows the row parser is wrong, so trust the printed figure but say so.
    if (totals.subtotal !== null && itemsSum > 0) {
      const drift = Math.abs(totals.subtotal - itemsSum) / Math.max(totals.subtotal, 1);
      if (drift > 0.005) {
        logger.warn(
          `InvoiceParser: line items sum ${itemsSum} vs printed subtotal ${totals.subtotal} (drift ${(drift * 100).toFixed(2)}%)`
        );
      }
    }

    logger.info(
      `InvoiceParser: ${result.itemCount} items, subtotal=${result.subtotal}, tax=${result.taxAmount}, total=${result.total}`
    );

    return result;
  }

  /* ── Row detection ─────────────────────────────────── */

  /**
   * Rows are recognised by walking the printed serial-number sequence
   * (1, 2, 3, ...). Relying on newlines is useless here because the extractor
   * joins every PDF text run with a single space.
   */
  _detectRows(text) {
    const candidates = [];
    ROW_START.lastIndex = 0;
    let m;
    while ((m = ROW_START.exec(text)) !== null) {
      const number = parseInt(m[1], 10);
      if (!Number.isFinite(number)) continue;
      const after = text.slice(m.index + m[0].length);
      // A quantity immediately followed by its unit is not a row start.
      if (isUnit(after.split(/\s+/)[0])) continue;
      if (!/\.\d/.test(after.slice(0, 500))) continue;
      candidates.push({ number, start: m.index, contentStart: m.index + m[0].length });
    }
    if (!candidates.length) return [];

    const chosen = [];
    let expected = 1;
    let cursor = 0;
    let guard = 0;

    while (expected <= 2000 && guard++ < 5000) {
      let idx = -1;
      for (let i = cursor; i < candidates.length; i++) {
        if (candidates[i].number === expected) { idx = i; break; }
      }
      if (idx === -1) {
        // A row may have been swallowed by a bad line break — allow a small gap.
        for (let n = expected + 1; idx === -1 && n <= expected + 3; n++) {
          for (let i = cursor; i < candidates.length; i++) {
            if (candidates[i].number === n) { idx = i; break; }
          }
        }
        if (idx === -1) break;
        expected = candidates[idx].number;
      }
      chosen.push(candidates[idx]);
      cursor = idx + 1;
      expected = candidates[idx].number + 1;
    }

    return chosen.map((row, i) => {
      const end = i + 1 < chosen.length ? chosen[i + 1].start : text.length;
      return { ...row, text: trimRow(text.slice(row.contentStart, end)) };
    });
  }

  /* ── Single row ────────────────────────────────────── */

  _parseRow(raw) {
    const tokens = raw.split(/\s+/).filter(Boolean);
    if (tokens.length < 3) return null;

    const numbers = [];
    tokens.forEach((t, i) => {
      if (isNumber(t)) numbers.push({ i, v: toNum(t) });
    });
    if (numbers.length < 3) return null;

    let triples = this._findTriples(numbers, tokens, true);
    if (!triples.length) triples = this._findTriples(numbers, tokens, false);
    if (!triples.length) return null;

    triples.sort((a, b) => {
      const da = /\./.test(tokens[a.pIdx]) ? 1 : 0;
      const db = /\./.test(tokens[b.pIdx]) ? 1 : 0;
      if (da !== db) return db - da;
      return b.amount - a.amount;
    });

    const t = triples[0];
    const { fIdx, pIdx, amount } = t;

    // Decide which factor is quantity and which is rate.
    const nextIsUnit = (k) => isUnit(tokens[k + 1]);
    const prevIsUnit = (k) => isUnit(tokens[k - 1]);
    const amountFirst = pIdx < Math.min(fIdx[0], fIdx[1]);

    let qtyIdx;
    let rateIdx;
    if (nextIsUnit(fIdx[0])) { qtyIdx = fIdx[0]; rateIdx = fIdx[1]; }
    else if (nextIsUnit(fIdx[1])) { qtyIdx = fIdx[1]; rateIdx = fIdx[0]; }
    else if (prevIsUnit(fIdx[0])) { rateIdx = fIdx[0]; qtyIdx = fIdx[1]; }
    else if (prevIsUnit(fIdx[1])) { rateIdx = fIdx[1]; qtyIdx = fIdx[0]; }
    else if (amountFirst) { rateIdx = fIdx[0]; qtyIdx = fIdx[1]; }
    else { qtyIdx = fIdx[0]; rateIdx = fIdx[1]; }

    const quantity = toNum(tokens[qtyIdx]);
    const rate = toNum(tokens[rateIdx]);
    if (!(quantity > 0) || !(rate > 0) || !(amount > 0)) return null;

    const unit = nextIsUnit(qtyIdx) ? tokens[qtyIdx + 1] : prevIsUnit(qtyIdx) ? tokens[qtyIdx - 1] : null;

    // Rate-slab columns (GST %, tax amount) sit between rate and amount on
    // "qty rate tax amount" layouts.
    let taxRate = null;
    let lineTax = null;
    if (pIdx === rateIdx + 3) {
      const pct = toNum(tokens[rateIdx + 1]);
      const tax = toNum(tokens[rateIdx + 2]);
      if (Number.isFinite(pct) && pct >= 0 && pct <= 100 && Number.isFinite(tax) && tax >= 0) {
        taxRate = pct;
        lineTax = tax;
      }
    }

    const descTokens = tokens.slice(0, Math.min(fIdx[0], fIdx[1], pIdx));
    const description = this._cleanDescription(descTokens);
    const hsn = this._extractHsn(tokens, [fIdx[0], fIdx[1], pIdx], amountFirst);

    return {
      description: description || 'Unnamed item',
      hsn,
      quantity: round2(quantity),
      unit,
      rate: round2(rate),
      amount: round2(amount),
      taxRate,
      taxAmount: lineTax === null ? null : round2(lineTax),
    };
  }

  /**
   * Find pairs whose product equals a third number. When `endOnly` is set the
   * product must be either the first or the last token of the three — a middle
   * product means we matched two incidental numbers, not qty x rate = amount.
   */
  _findTriples(numbers, tokens, endOnly) {
    const out = [];
    for (let a = 0; a < numbers.length; a++) {
      for (let b = a + 1; b < numbers.length; b++) {
        const product = numbers[a].v * numbers[b].v;
        if (!Number.isFinite(product) || product <= 0) continue;
        for (let c = 0; c < numbers.length; c++) {
          if (c === a || c === b) continue;
          const value = numbers[c].v;
          if (!(value > 0)) continue;
          if (Math.abs(product - value) > Math.max(0.01, value * 0.01)) continue;
          const fIdx = [numbers[a].i, numbers[b].i];
          const pIdx = numbers[c].i;
          if (endOnly) {
            const lo = Math.min(fIdx[0], fIdx[1], pIdx);
            const hi = Math.max(fIdx[0], fIdx[1], pIdx);
            if (pIdx !== lo && pIdx !== hi) continue;
          }
          out.push({ fIdx, pIdx, amount: value });
        }
      }
    }
    return out;
  }

  _cleanDescription(parts) {
    const tokens = [...parts];
    while (tokens.length && HSN_TOKEN.test(tokens[tokens.length - 1])) tokens.pop();
    while (tokens.length && /^[A-Z]$/.test(tokens[tokens.length - 1])) tokens.pop();
    return tokens
      .join(' ')
      .replace(/^[\s.]+/, '')
      .replace(/[.\s]+$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  _extractHsn(tokens, tripleIdx, amountFirst) {
    const inTriple = new Set(tripleIdx);
    const candidates = [];
    tokens.forEach((t, i) => {
      if (!inTriple.has(i) && HSN_TOKEN.test(t)) candidates.push(t);
    });
    if (!candidates.length) return null;
    return amountFirst ? candidates[candidates.length - 1] : candidates[0];
  }

  /* ── Totals ────────────────────────────────────────── */

  _extractTotals(text, itemsSum) {
    const out = {
      subtotal: null, total: null, taxAmount: null, roundOff: null,
      source: { subtotal: null, total: null, tax: null },
    };

    const money = '([0-9][0-9,]*(?:\\.\\d{1,3})?)';

    for (const [label, pattern] of [
      ['grand_total', new RegExp(`grand\\s*total[\\s:]*(?:rs\\.?|₹|inr)?\\s*${money}`, 'i')],
      ['total_inr', new RegExp(`total\\s*₹\\s*${money}`, 'i')],
      ['payable', new RegExp(`(?:net|total)\\s*payable[\\s:]*(?:rs\\.?|₹|inr)?\\s*${money}`, 'i')],
      ['total_amount', new RegExp(`total\\s*amount[\\s:]*(?:rs\\.?|₹|inr)\\s*${money}`, 'i')],
    ]) {
      const m = text.match(pattern);
      if (m?.[1]) {
        const v = toNum(m[1]);
        if (v > 0) { out.total = round2(v); out.source.total = label; break; }
      }
    }

    const beforeTax = [
      new RegExp(`taxable\\s*(?:value|amount)[\\s:]*(?:rs\\.?|₹|inr)?\\s*${money}`, 'i'),
      new RegExp(`sub\\s*total[\\s:]*(?:rs\\.?|₹|inr)?\\s*${money}`, 'i'),
      new RegExp(`net\\s*amount[\\s:]*(?:rs\\.?|₹|inr)?\\s*${money}`, 'i'),
      new RegExp(`${money}\\s*(?:cgst|sgst|igst)\\s*@`, 'i'),
    ];
    for (const pattern of beforeTax) {
      const m = text.match(pattern);
      if (m?.[1]) {
        const v = toNum(m[1]);
        if (v > 0) { out.subtotal = round2(v); out.source.subtotal = 'printed'; break; }
      }
    }

    // Busy-style rate-slab summary: "Basic Amt 4500.00 64552.46 2101.50".
    if (out.subtotal === null) {
      const m = text.match(/basic\s*amt([\s\S]{0,120}?)(?:cgst|sgst|tax)/i);
      if (m) {
        const parts = (m[1].match(/[0-9][0-9,]*\.\d{1,3}/g) || []).map(toNum);
        if (parts.length) {
          const sum = round2(parts.reduce((s, v) => s + v, 0));
          if (sum > 0) { out.subtotal = sum; out.source.subtotal = 'slabs'; }
        }
      }
    }

    if (out.subtotal === null && itemsSum > 0) {
      out.subtotal = itemsSum;
      out.source.subtotal = 'items';
    }

    const round = text.match(/round\s*off\s*(\(\s*[-−]\s*\)|\(\s*\+\s*\)|[-−+])?\s*([0-9][0-9,]*(?:\.\d+)?)/i);
    if (round?.[2]) {
      const negative = round[1] ? /[-−]/.test(round[1]) : false;
      out.roundOff = (negative ? -1 : 1) * toNum(round[2]);
    }

    if (out.total !== null && out.subtotal !== null) {
      const tax = round2(out.total - out.subtotal - (out.roundOff || 0));
      if (tax > 0) {
        out.taxAmount = tax;
        out.source.tax = 'derived';
      }
    }

    if (out.taxAmount === null) {
      const parts = [];
      for (const m of text.matchAll(/(?:cgst|sgst|igst)\s*@?\s*[\d.]+\s*%[\s\S]{0,40}?([0-9][0-9,]*\.\d{1,3})/gi)) {
        parts.push(toNum(m[1]));
      }
      const sum = round2(parts.reduce((s, v) => s + v, 0));
      if (sum > 0) {
        out.taxAmount = sum;
        out.source.tax = 'components';
        if (out.total === null && out.subtotal !== null) out.total = round2(out.subtotal + sum + (out.roundOff || 0));
      }
    }

    if (out.total === null && out.subtotal !== null && out.taxAmount !== null) {
      out.total = round2(out.subtotal + out.taxAmount + (out.roundOff || 0));
      out.source.total = 'summed';
    }

    return out;
  }
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export default new InvoiceParser();
