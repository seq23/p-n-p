// The live price table for invoices. The ONLY source of prices is the three data
// files the public site renders from; validate:admin-prices fails if this file
// stops importing them or if invoice prices drift from them.
//
// Rentals inventory (owner, 18 Oct 2026): Valerie edits the items in Settings -> Inventory, which
// stores them in D1 (table inventory_items, functions/_lib/inventory.mjs) and publishes them back
// into data/rentals/games.json. Until a change is live on the website, the admin, the /request
// form and its availability answer read the D1 copy straight away: every entry point calls
// useInventory(env) (functions/_lib/inventory.mjs), which swaps the tables below through
// applyInventory(). The bundled games.json is the starting point and the fallback.
import games from '../../data/rentals/games.json';
import services from '../../data/offers/services.json';
import porchPackages from '../../data/offers/porch_packages.json';
import { buildPriceTable, buildTrackTable } from './pricing.mjs';

export const BUNDLED_GAMES = games;
export let GAMES = games;
export let PRICE_TABLE = buildPriceTable(games, services, porchPackages);
// The admin side's item list: the price table plus games.json adminItems (the Projector,
// owner 18 Oct 2026): tracked In/Out, counted for availability, pickable on the booking form,
// never priced and never on a public page (they are not in PRICE_TABLE.items).
export let TRACK_TABLE = buildTrackTable(PRICE_TABLE, games);
export const CONTACT = services.contact || {};

// Swap in a games.json-shaped object (the D1 inventory merged over the bundled file).
export function applyInventory(data) {
  GAMES = data;
  PRICE_TABLE = buildPriceTable(data, services, porchPackages);
  TRACK_TABLE = buildTrackTable(PRICE_TABLE, data);
}
