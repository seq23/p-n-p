'use strict';
/**
 * Business delivery for game rentals (owner, 19 Oct 2026). Home and personal rentals stay pickup
 * and return at the safe exchange zone; a BUSINESS can have the games delivered for the delivery
 * fee. The fee is the admin invoice quick-add's (data/offers/services.json
 * invoiceQuickAdds.deliveryFee), so the website and the invoice can never quote two prices. Every
 * public mention uses businessDeliveryLine(). The /request form does not offer it (owner, 19 Oct
 * 2026); Valerie sets it on the admin Change anything page → Customer details.
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
const DELIVERY_LINE_DESC = 'Delivery fee';
module.exports = { deliveryFee, businessDeliveryLine, DELIVERY_LINE_DESC };
