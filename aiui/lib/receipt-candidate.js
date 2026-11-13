// Pure boundary adapter only: no network, storage, camera, or accounting writes.
const keys = ['amount', 'expenseDate', 'currencyCode', 'merchant', 'warnings'];
const limits = { amount: 32, expenseDate: 32, currencyCode: 16, merchant: 150 };
const failure = code => ({ ok: false, code });
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && value.slice(0, 4) !== '0000'
  && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
  && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

// Accept only the decoded Flow Ledger ReceiptCandidate response, not provider output.
// A future authenticated transport must bound bytes before decoding JSON.
export function adaptReceiptResponse(status, body) {
  if (status !== 200) {
    if (status === 401 || status === 403) return failure('AUTH_REQUIRED');
    if (status === 429) return failure('RATE_LIMITED');
    if (status === 504) return failure('TIMEOUT');
    return failure('RECOGNITION_FAILED');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(body))
    || Object.keys(body).length !== keys.length
    || keys.some(key => !Object.hasOwn(body, key))) return failure('INVALID_RESULT');
  for (const [key, max] of Object.entries(limits)) {
    if (typeof body[key] !== 'string' || body[key].length > max) return failure('INVALID_RESULT');
  }
  // The backend adds up to four warnings to the provider's six warnings.
  if (!Array.isArray(body.warnings) || body.warnings.length > 10
    || body.warnings.some(note => typeof note !== 'string' || note.length > 200)) return failure('INVALID_RESULT');
  const values = { amount: '', expenseDate: '', currencyCode: '', merchant: body.merchant.trim(), category: '', note: '' };
  const missingFields = [];
  if (/^\d{1,14}(\.\d{1,6})?$/.test(body.amount) && /[1-9]/.test(body.amount)) values.amount = body.amount;
  else missingFields.push('amount');
  if (validDate(body.expenseDate)) values.expenseDate = body.expenseDate;
  else missingFields.push('expenseDate');
  if (/^[A-Z]{3}$/.test(body.currencyCode)) values.currencyCode = body.currencyCode;
  else missingFields.push('currencyCode');
  // No account, category, date, currency or amount may be inferred here.
  missingFields.push('category');
  return { ok: true, values, missingFields, warnings: [...body.warnings], requiresConfirmation: true };
}
