// Travel vertical — flight + hotel search.
//
// Ships with stub catalogs (5 flights, 5 hotels) so the demo works offline
// with zero account setup. The tool contracts (travel_search_flights,
// travel_search_hotels, travel_compare_flights) are stable — swap in a real
// backend by replacing just the `execute` bodies below.
//
// SWAP PATTERNS (sketched — not wired by default):
//
//   Amadeus Self-Service (free dev tier, AMADEUS_API_KEY + AMADEUS_API_SECRET):
//     travel_search_flights → GET /v2/shopping/flight-offers?originLocationCode=...
//     travel_search_hotels  → GET /v3/shopping/hotel-offers?cityCode=...
//     travel_compare_flights → local diff on two /v2/shopping/flight-offers results
//     (Amadeus has generous free tier — 10k test-env requests/month.)
//
//   Skyscanner / Kiwi / Duffel: partner access required.
//
//   Browser scraping (fallback when no API credentials): wire OpenClaw's
//   browser tool via MCP to google.com/flights or kayak.com. Fragile and
//   rate-limited; use only if the user explicitly opts in.
//
// Keep the same return shape (id, carrier, from/to, depart/arrive, stops,
// price for flights; id, name, city, neighborhood, rating, pricePerNight for
// hotels) so downstream graphs don't care which backend is serving them.

import { Type } from "@sinclair/typebox";

const FAKE_FLIGHTS = [
  { id: "F-SFO-JFK-A", carrier: "United", from: "SFO", to: "JFK", depart: "08:15", arrive: "16:35", stops: 0, price: 428 },
  { id: "F-SFO-JFK-B", carrier: "JetBlue", from: "SFO", to: "JFK", depart: "11:40", arrive: "20:05", stops: 0, price: 372 },
  { id: "F-SFO-JFK-C", carrier: "Delta",  from: "SFO", to: "JFK", depart: "22:55", arrive: "07:20+1", stops: 0, price: 291 },
  { id: "F-SFO-LHR-A", carrier: "British Airways", from: "SFO", to: "LHR", depart: "19:35", arrive: "14:10+1", stops: 0, price: 912 },
  { id: "F-SFO-LHR-B", carrier: "Virgin Atlantic", from: "SFO", to: "LHR", depart: "17:10", arrive: "11:20+1", stops: 0, price: 856 },
];

const FAKE_HOTELS = [
  { id: "H-NYC-A", name: "The Pod Times Square",  city: "New York",  neighborhood: "Midtown",  rating: 4.2, pricePerNight: 189 },
  { id: "H-NYC-B", name: "Ace Hotel New York",    city: "New York",  neighborhood: "NoMad",    rating: 4.5, pricePerNight: 302 },
  { id: "H-NYC-C", name: "citizenM Bowery",       city: "New York",  neighborhood: "LES",      rating: 4.6, pricePerNight: 267 },
  { id: "H-LDN-A", name: "The Hoxton Shoreditch", city: "London",    neighborhood: "Shoreditch", rating: 4.4, pricePerNight: 221 },
  { id: "H-LDN-B", name: "CitizenM Tower of London", city: "London", neighborhood: "Tower Hill", rating: 4.5, pricePerNight: 198 },
];

const toolText = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });

export const vertical = {
  id: "travel",
  description: "Flight + hotel search and comparison (stub catalog in v1).",
  guidance_for_compiler: `
AVAILABLE TOOLS — pick only from this list:
- travel_search_flights: find flights between two airports (3-letter codes), optional max price
- travel_search_hotels: find hotels in a city, optional max price/night and min rating
- travel_compare_flights: side-by-side comparison of two flight ids

RULES:
1. The entry node's allowed_tools MUST include one of "travel_search_flights" or "travel_search_hotels".
2. Comparison ("travel_compare_flights") must come after searching has returned at least two candidates.
`.trim(),
  tools: [
    {
      name: "travel_search_flights",
      description: "Search flights between two airports (3-letter IATA codes). Optional max price.",
      parameters: Type.Object({
        from: Type.String({ description: "3-letter IATA code, e.g. SFO" }),
        to: Type.String({ description: "3-letter IATA code, e.g. JFK" }),
        maxPrice: Type.Optional(Type.Number()),
      }),
      async execute(_id, params) {
        const matches = FAKE_FLIGHTS.filter(
          (f) =>
            f.from.toUpperCase() === params.from.toUpperCase() &&
            f.to.toUpperCase() === params.to.toUpperCase() &&
            (params.maxPrice == null || f.price <= params.maxPrice),
        );
        return toolText({ total_matches: matches.length, flights: matches });
      },
    },
    {
      name: "travel_search_hotels",
      description: "Search hotels in a city. Optional max price/night and min star rating.",
      parameters: Type.Object({
        city: Type.String(),
        maxPricePerNight: Type.Optional(Type.Number()),
        minRating: Type.Optional(Type.Number()),
      }),
      async execute(_id, params) {
        const city = params.city.toLowerCase();
        const matches = FAKE_HOTELS.filter((h) => {
          if (!h.city.toLowerCase().includes(city)) return false;
          if (params.maxPricePerNight != null && h.pricePerNight > params.maxPricePerNight) return false;
          if (params.minRating != null && h.rating < params.minRating) return false;
          return true;
        });
        return toolText({ total_matches: matches.length, hotels: matches });
      },
    },
    {
      name: "travel_compare_flights",
      description: "Side-by-side comparison of two flights by id. Returns full records + a price/duration delta.",
      parameters: Type.Object({ flightIdA: Type.String(), flightIdB: Type.String() }),
      async execute(_id, params) {
        const a = FAKE_FLIGHTS.find((f) => f.id === params.flightIdA);
        const b = FAKE_FLIGHTS.find((f) => f.id === params.flightIdB);
        if (!a || !b)
          return { content: [{ type: "text", text: `Missing flight(s). a=${!!a} b=${!!b}` }], isError: true };
        return toolText({ a, b, delta: { price_difference: +(a.price - b.price).toFixed(2) } });
      },
    },
  ],
};
