// The ONE map of booking kinds, grouped by the four services in scripts/lib/brand.js SERVICES
// (porch, party, grazing, rentals). Calendar, day sheet, ICS, reminders, search, the Money
// split and the Google Sheet sync all read it. validate:admin-calendar fails if a SERVICES key
// has no kind here. "other" is a fallback only.
// Four colours, one per service (owner, 18 Oct 2026): orange porch, purple party, green
// grazing, blue rentals. Always shown with words; dark ink (#2b2420) on the light tint and on
// white beside the coloured bar is >= 4.5:1 (validate:admin-calendar checks the ratio).
export const SERVICE_KINDS = {
  porch: { label: 'Porch decorating', short: 'Porch', color: 'orange', bar: '#c2410c', tint: '#ffedd5', kinds: ['porch_install', 'porch_takedown'] },
  party: { label: 'Party planning & decor', short: 'Party', color: 'purple', bar: '#7e22ce', tint: '#f3e8ff', kinds: ['party_setup', 'party_takedown'] },
  grazing: { label: 'Grazing tables', short: 'Grazing', color: 'green', bar: '#15803d', tint: '#dcfce7', kinds: ['grazing_setup', 'grazing_pickup'] },
  rentals: { label: 'Party game rentals', short: 'Rentals', color: 'blue', bar: '#1d4ed8', tint: '#dbeafe', kinds: ['rental_pickup', 'rental_return'] },
};
export const OTHER_SERVICE = { label: 'Other', short: 'Other', color: 'grey', bar: '#57534e', tint: '#f5f5f4', kinds: ['other'] };
export const INK = '#2b2420';

export const KIND_LABELS = {
  rental_pickup: 'Rental pickup', rental_return: 'Rental return',
  porch_install: 'Porch install', porch_takedown: 'Porch takedown',
  party_setup: 'Party setup', party_takedown: 'Party takedown',
  grazing_setup: 'Grazing table setup', grazing_pickup: 'Grazing table pickup',
  other: 'Other',
};

export const KINDS = [...Object.values(SERVICE_KINDS).flatMap((s) => s.kinds), 'other'];

export function serviceOfKind(kind) {
  const hit = Object.entries(SERVICE_KINDS).find(([, s]) => s.kinds.includes(kind));
  return hit ? hit[0] : 'other';
}

// Which service an invoice line belongs to (for the Money split).
export function serviceOfLine(description, isRentalLine) {
  const d = String(description || '').toLowerCase();
  if (isRentalLine) return 'rentals';
  if (/grazing|charcuterie|board/.test(d)) return 'grazing';
  if (/porch/.test(d)) return 'porch';
  if (/decor|party|hotel|balloon|celebration|takedown|setup/.test(d)) return 'party';
  return 'other';
}

export function serviceInfo(kind) {
  const key = serviceOfKind(kind);
  return key === 'other' ? OTHER_SERVICE : SERVICE_KINDS[key];
}

// Chip CSS: a coloured left bar + light tint of the kind's service, dark ink text.
export function kindCss() {
  return KINDS.map((k) => { const s = serviceInfo(k); return `.k.${k}{border-color:${s.bar};background:${s.tint};color:${INK}}`; }).join('');
}

// The colour key shown at the top of Month and List views.
export function serviceKey() {
  return [...Object.values(SERVICE_KINDS), OTHER_SERVICE].map((s) => `<span class="k" style="border-color:${s.bar};background:${s.tint};color:${INK}">${s.label}: ${s.kinds.map((k) => KIND_LABELS[k]).join(', ')}</span>`).join('');
}
