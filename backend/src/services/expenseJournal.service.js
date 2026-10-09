import Decimal from 'decimal.js';

/**
 * Build the debit/credit lines for an expense posting.
 *
 * The whole reason this exists: an expense approval must produce an entry
 * whose debits equal its credits. The credit line is always the invoice grand
 * total, so the expense line has to absorb whatever the GST accounts did not —
 * the tax when the GST split is known, and additionally the invoice's round-off
 * residual when it is not.
 *
 * When `tax` is empty (no `gstRate`, e.g. an invoice carrying mixed slabs),
 * no Input CGST/SGST/IGST lines are emitted at all: the ledger validator
 * requires `gstDetails` whenever those accounts appear, and `gstDetails` can
 * only be derived from a single statutory rate. The whole payment therefore
 * lands on the expense and the entry still balances.
 *
 * Pure and side-effect free — covered by tests/expenseJournal.test.js.
 */
export const buildExpenseJournalLines = ({
  expenseAccountId,
  cashAccountId,
  gstAccountIds = {},
  category,
  paymentMethod,
  totalAmount,
  tax = {},
}) => {
  const total = new Decimal(totalAmount ?? 0);

  const gstLines = [
    { amount: new Decimal(tax.cgst ?? 0), accountId: gstAccountIds.cgst, description: 'Input CGST' },
    { amount: new Decimal(tax.sgst ?? 0), accountId: gstAccountIds.sgst, description: 'Input SGST' },
    { amount: new Decimal(tax.igst ?? 0), accountId: gstAccountIds.igst, description: 'Input IGST' },
  ].filter(({ amount, accountId }) => amount.greaterThan(0) && accountId);

  // Only tax we can actually post may be deducted from the expense line,
  // otherwise the two sides drift apart.
  const postedTax = gstLines.reduce(
    (sum, { amount }) => sum.plus(amount),
    new Decimal(0),
  );

  const lines = [
    {
      account: expenseAccountId,
      debit: total.minus(postedTax).toFixed(2),
      credit: '0',
      description: `${category} expense`,
    },
    ...gstLines.map(({ amount, accountId, description }) => ({
      account: accountId,
      debit: amount.toFixed(2),
      credit: '0',
      description,
    })),
    {
      account: cashAccountId,
      debit: '0',
      credit: total.toFixed(2),
      description: `Payment via ${paymentMethod}`,
    },
  ];

  return lines;
};

/** Sum of the debit and credit sides of a journal line array. */
export const lineTotals = (lines) =>
  lines.reduce(
    (acc, line) => ({
      debit: acc.debit.plus(new Decimal(line.debit ?? 0)),
      credit: acc.credit.plus(new Decimal(line.credit ?? 0)),
    }),
    { debit: new Decimal(0), credit: new Decimal(0) },
  );
