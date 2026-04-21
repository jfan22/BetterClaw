// Shopping vertical — embedded catalog. We started with fakestoreapi.com but
// it's behind Cloudflare challenge (403 from any non-browser client), so we
// switched to a local catalog for zero-network-dependency demos. Real
// deployments would swap this for a real catalog MCP (Amazon PA API,
// Shopify, or a scraping MCP via the browser tool).

import { Type } from "@sinclair/typebox";

const CATALOG = [
  { id: 1,  title: "Logitech MX Master 3S Wireless Mouse",        price: 99.99, category: "electronics",    description: "Flagship ergonomic wireless mouse. Ultra-fast scrolling. Silent click.",           rating: { rate: 4.8, count: 3241 } },
  { id: 2,  title: "Logitech M185 Wireless Mouse",                price: 16.99, category: "electronics",    description: "Budget wireless mouse, 1000 DPI, 1-year battery.",                                  rating: { rate: 4.3, count: 8210 } },
  { id: 3,  title: "Razer Basilisk V3 Pro Wireless Mouse",        price: 149.99, category: "electronics",   description: "Gaming-grade wireless mouse. 11 buttons, 4000Hz polling.",                          rating: { rate: 4.6, count: 1123 } },
  { id: 4,  title: "Anker Wireless Ergonomic Vertical Mouse",     price: 34.99, category: "electronics",    description: "Affordable vertical wireless mouse. Adjustable DPI. 18-month battery.",             rating: { rate: 4.2, count: 4050 } },
  { id: 5,  title: "Apple Magic Mouse 2",                         price: 79.00, category: "electronics",    description: "Apple's multi-touch wireless mouse. Rechargeable. Minimalist design.",              rating: { rate: 4.0, count: 2890 } },
  { id: 6,  title: "Sony WH-1000XM5 Headphones",                  price: 349.00, category: "electronics",   description: "Flagship noise-canceling wireless headphones.",                                     rating: { rate: 4.7, count: 5612 } },
  { id: 7,  title: "Keychron K6 Wireless Mechanical Keyboard",    price: 84.00, category: "electronics",    description: "65% layout wireless mechanical keyboard. Hot-swappable switches.",                  rating: { rate: 4.5, count: 1832 } },
  { id: 8,  title: "Anker Soundcore Life Q30 Headphones",         price: 79.99, category: "electronics",    description: "Budget noise-canceling wireless headphones, 40h battery.",                          rating: { rate: 4.4, count: 9217 } },
  { id: 9,  title: "Fossil Gen 6 Smartwatch",                     price: 199.00, category: "electronics",   description: "Wear OS smartwatch with heart-rate, GPS, speaker.",                                 rating: { rate: 4.1, count: 1104 } },
  { id: 10, title: "Silver Hoop Earrings",                        price: 24.50,  category: "jewelery",      description: "Sterling silver classic hoop earrings, 1-inch diameter.",                           rating: { rate: 4.4, count: 230 } },
  { id: 11, title: "Men's Casual Slim Fit Shirt",                 price: 29.99,  category: "men's clothing",  description: "Classic fit slim button-down shirt, cotton blend.",                               rating: { rate: 4.2, count: 511 } },
  { id: 12, title: "Women's Winter Parka",                        price: 139.00, category: "women's clothing", description: "Insulated parka with faux fur hood. Waterproof shell.",                           rating: { rate: 4.6, count: 340 } },
];

async function loadCatalog() {
  return CATALOG;
}

function toolText(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

export const vertical = {
  id: "shopping",
  description: "Search and compare products in an online store.",
  guidance_for_compiler: `
AVAILABLE TOOLS — pick only from this list:
- shop_search: search the product catalog by keywords; returns list of {id, title, price, category}
- shop_details: fetch the full record for one product by id
- shop_compare: side-by-side details for two product ids

RULES:
1. The entry node's allowed_tools MUST include "shop_search" (every workflow starts by searching).
2. Fetching details ("shop_details") must come after searching.
3. Comparing ("shop_compare") must come after you have at least two candidates from searching or getting details.
`.trim(),
  tools: [
    {
      name: "shop_search",
      description:
        "Search the product catalog. Matches keywords against title, description, and category. Optionally filter by max price.",
      parameters: Type.Object({
        query: Type.String({ description: "Keywords to match" }),
        maxPrice: Type.Optional(Type.Number({ description: "Price ceiling in USD" })),
        category: Type.Optional(
          Type.String({
            description:
              "Optional category filter. Known values: 'electronics', 'jewelery', 'men's clothing', 'women's clothing'.",
          }),
        ),
        maxResults: Type.Optional(Type.Number({ default: 5 })),
      }),
      async execute(_id, params) {
        const catalog = await loadCatalog();
        const q = String(params.query || "").toLowerCase();
        const terms = q.split(/\s+/).filter(Boolean);
        const matches = catalog.filter((p) => {
          const hay = `${p.title} ${p.description} ${p.category}`.toLowerCase();
          const textMatch = terms.length === 0 || terms.some((t) => hay.includes(t));
          const priceOk = params.maxPrice == null || p.price <= params.maxPrice;
          const catOk = !params.category || p.category === params.category;
          return textMatch && priceOk && catOk;
        });
        const limited = matches.slice(0, params.maxResults ?? 5).map((p) => ({
          id: p.id,
          title: p.title,
          price: p.price,
          category: p.category,
          rating: p.rating,
        }));
        return toolText({ total_matches: matches.length, returned: limited.length, results: limited });
      },
    },
    {
      name: "shop_details",
      description: "Fetch the full record for one product (title, description, image URL, rating).",
      parameters: Type.Object({
        productId: Type.Number({ description: "Product id from shop_search" }),
      }),
      async execute(_id, params) {
        const catalog = await loadCatalog();
        const p = catalog.find((x) => x.id === Number(params.productId));
        if (!p) {
          return {
            content: [
              { type: "text", text: `No product with id ${params.productId}` },
            ],
            isError: true,
          };
        }
        return toolText(p);
      },
    },
    {
      name: "shop_compare",
      description:
        "Side-by-side comparison of two products. Returns both records + a field-by-field delta (price, rating, category).",
      parameters: Type.Object({
        productIdA: Type.Number(),
        productIdB: Type.Number(),
      }),
      async execute(_id, params) {
        const catalog = await loadCatalog();
        const a = catalog.find((x) => x.id === Number(params.productIdA));
        const b = catalog.find((x) => x.id === Number(params.productIdB));
        if (!a || !b) {
          return {
            content: [
              {
                type: "text",
                text: `Missing product(s). a=${a ? "ok" : "not found"} b=${b ? "ok" : "not found"}`,
              },
            ],
            isError: true,
          };
        }
        const delta = {
          price_difference: +(a.price - b.price).toFixed(2),
          rating_difference: +((a.rating?.rate ?? 0) - (b.rating?.rate ?? 0)).toFixed(2),
          same_category: a.category === b.category,
        };
        return toolText({ a, b, delta });
      },
    },
  ],
};
