// The live price table for invoices. The ONLY source of prices is the three data
// files the public site renders from; validate:admin-prices fails if this file
// stops importing them or if invoice prices drift from them.
import games from '../../data/rentals/games.json';
import services from '../../data/offers/services.json';
import porchPackages from '../../data/offers/porch_packages.json';
import { buildPriceTable, buildTrackTable } from './pricing.mjs';

export const PRICE_TABLE = buildPriceTable(games, services, porchPackages);
// The admin side's item list: the price table plus games.json adminItems (the Projector,
// owner 18 Oct 2026): tracked In/Out, counted for availability, pickable on the booking form,
// never priced and never on a public page (they are not in PRICE_TABLE.items).
export const TRACK_TABLE = buildTrackTable(PRICE_TABLE, games);
export const CONTACT = services.contact || {};
