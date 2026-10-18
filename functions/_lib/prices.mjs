// The live price table for invoices. The ONLY source of prices is the three data
// files the public site renders from; validate:admin-prices fails if this file
// stops importing them or if invoice prices drift from them.
import games from '../../data/rentals/games.json';
import services from '../../data/offers/services.json';
import porchPackages from '../../data/offers/porch_packages.json';
import { buildPriceTable } from './pricing.mjs';

export const PRICE_TABLE = buildPriceTable(games, services, porchPackages);
export const CONTACT = services.contact || {};
