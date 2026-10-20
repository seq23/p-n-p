'use strict';
/**
 * Business delivery for game rentals (owner, 19 Oct 2026). Home and personal rentals stay pickup
 * and return at the safe exchange zone; a BUSINESS can have the games delivered for the delivery
 * fee. The fee is the admin invoice quick-add's (data/offers/services.json
 * invoiceQuickAdds.deliveryFee), so the website, the /request form, the invoice and the draft
 * invoice line can never quote two prices. Every public mention uses businessDeliveryLine().
 */
function deliveryFee(services) {
  const fee = Number(services && services.invoiceQuickAdds && services.invoiceQuickAdds.deliveryFee);
  if (!Number.isFinite(fee) || fee <= 0) throw new Error('services.json invoiceQuickAdds.deliveryFee is missing');
  return fee;
}
const dollars = (n) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
function businessDeliveryLine(services) {
  return `Renting for a business? We can deliver to your business for ${dollars(deliveryFee(services))}.`;
}
function tickLabel(services) {
  return `This is for a business — deliver to us (${dollars(deliveryFee(services))})`;
}
const DELIVERY_LINE_DESC = 'Delivery fee';
module.exports = { deliveryFee, businessDeliveryLine, tickLabel, DELIVERY_LINE_DESC };
