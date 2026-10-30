import { b64urlText } from './util.mjs';

export const PAID_LABEL = '✓ They paid the deposit';
export const PAID_HINT = "Paid by Zelle or Cash App? Tap 'They paid' so this comes off the list.";
export const paidHref = (key, invoiceId = '') => `/admin/requests/deposit?r=${b64urlText(key || '')}${invoiceId ? `&invoice=${invoiceId}` : ''}`;
export const paidButton = (key, invoiceId = '') => ({ label: PAID_LABEL, href: paidHref(key, invoiceId), solid: true });
// The booking deposit still needed, then the remaining balance once that deposit is in.
export const depositLeft = (inv, bal) => Math.min(bal.remaining, Math.max(0, (inv.deposit_due_cents || 0) - bal.paid) || bal.remaining);
export const depositReceived = (inv, bal) => bal.paid > 0 && bal.paid >= (inv.deposit_due_cents || bal.total);
