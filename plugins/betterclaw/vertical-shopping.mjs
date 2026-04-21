// Shopping vertical — backed by https://dummyjson.com (free, no auth, 194
// real products across 24 categories with server-side search + categories +
// full product records including reviews). A step up from the initial embedded
// catalog, and a step down from a real commercial API like Amazon's Product
// Advertising. Zero account setup; works from any Node 22 environment.
//
// Swap this for a real commercial backend by implementing the same three
// tool contracts (shop_search, shop_details, shop_compare) against whichever
// API you have creds for — the workflow graph schema and BetterClaw plugin
// don't know which backend they're talking to.

import { Type } from "@sinclair/typebox";

const API = "https://dummyjson.com";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return res.json();
}

function toolText(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

// Trim the fat: dummyjson product records are ~1.5KB each; agents don't need
// dimensions, stock, shipping info, full reviews, etc. for search. Details
// keeps more — useful when the agent's comparing.
function summarize(p) {
  return {
    id: p.id,
    title: p.title,
    brand: p.brand ?? null,
    category: p.category,
    price: p.price,
    discount_percent: p.discountPercentage ?? 0,
    rating: p.rating,
    stock: p.stock,
    tags: p.tags ?? [],
  };
}

function detail(p) {
  return {
    ...summarize(p),
    description: p.description,
    availability: p.availabilityStatus,
    warranty: p.warrantyInformation,
    shipping: p.shippingInformation,
    return_policy: p.returnPolicy,
    review_count: (p.reviews ?? []).length,
    average_review_rating:
      p.reviews && p.reviews.length > 0
        ? +(p.reviews.reduce((s, r) => s + r.rating, 0) / p.reviews.length).toFixed(2)
        : null,
  };
}

export const vertical = {
  id: "shopping",
  description: "Real product catalog search + compare via dummyjson.com (194 products, 24 categories).",
  guidance_for_compiler: `
AVAILABLE TOOLS — pick only from this list:
- shop_search: keyword search across titles and descriptions. Server-side. Returns id+title+price+category+rating.
- shop_details: full product record by id: description, reviews, availability, warranty, shipping, return policy.
- shop_compare: side-by-side of two products with delta on price, rating, and category match.

CATEGORIES (pick from this list when filtering): beauty, fragrances, furniture, groceries, home-decoration, kitchen-accessories, laptops, mens-shirts, mens-shoes, mens-watches, mobile-accessories, motorcycle, skin-care, smartphones, sports-accessories, sunglasses, tablets, tops, vehicle, womens-bags, womens-dresses, womens-jewellery, womens-shoes, womens-watches.

RULES:
1. The entry node's allowed_tools MUST include "shop_search".
2. Fetching details ("shop_details") must come after searching.
3. Comparing ("shop_compare") must come after you have at least two candidates from search/details.
`.trim(),
  tools: [
    {
      name: "shop_search",
      description:
        "Search the product catalog. Matches against title/description/tags. Optional max-price filter. Returns summary records (id, title, brand, price, rating, category).",
      parameters: Type.Object({
        query: Type.String({ description: "Keywords to match" }),
        maxPrice: Type.Optional(Type.Number({ description: "Price ceiling in USD" })),
        category: Type.Optional(
          Type.String({
            description: "Optional category filter (use the slug from the categories list in this vertical's guidance).",
          }),
        ),
        maxResults: Type.Optional(Type.Number({ default: 5 })),
      }),
      async execute(_id, params) {
        const limit = Math.min(params.maxResults ?? 5, 30);
        // dummyjson doesn't combine search + category, so: if category given,
        // fetch category then filter in-memory; otherwise use search endpoint.
        let products;
        if (params.category) {
          const data = await fetchJson(
            `${API}/products/category/${encodeURIComponent(params.category)}?limit=100`,
          );
          const q = String(params.query || "").toLowerCase();
          products = (data.products || []).filter((p) =>
            !q || `${p.title} ${p.description}`.toLowerCase().includes(q),
          );
        } else {
          const data = await fetchJson(
            `${API}/products/search?q=${encodeURIComponent(params.query)}&limit=${limit * 2}`,
          );
          products = data.products || [];
        }
        const priced = products.filter((p) => params.maxPrice == null || p.price <= params.maxPrice);
        const results = priced.slice(0, limit).map(summarize);
        return toolText({ total_matches: priced.length, returned: results.length, results });
      },
    },
    {
      name: "shop_details",
      description: "Fetch the full record for one product (description, reviews summary, availability, warranty, shipping, return policy).",
      parameters: Type.Object({
        productId: Type.Number({ description: "Product id from shop_search" }),
      }),
      async execute(_id, params) {
        try {
          const p = await fetchJson(`${API}/products/${Number(params.productId)}`);
          return toolText(detail(p));
        } catch (err) {
          return {
            content: [{ type: "text", text: `No product with id ${params.productId} (${err.message})` }],
            isError: true,
          };
        }
      },
    },
    {
      name: "shop_compare",
      description:
        "Side-by-side comparison of two products. Returns both full records + a delta on price, rating, discount, and whether they share a category.",
      parameters: Type.Object({
        productIdA: Type.Number(),
        productIdB: Type.Number(),
      }),
      async execute(_id, params) {
        try {
          const [a, b] = await Promise.all([
            fetchJson(`${API}/products/${Number(params.productIdA)}`),
            fetchJson(`${API}/products/${Number(params.productIdB)}`),
          ]);
          const delta = {
            price_difference_usd: +(a.price - b.price).toFixed(2),
            rating_difference: +(a.rating - b.rating).toFixed(2),
            discount_difference_points: +((a.discountPercentage ?? 0) - (b.discountPercentage ?? 0)).toFixed(2),
            same_category: a.category === b.category,
            category_a: a.category,
            category_b: b.category,
          };
          return toolText({ a: detail(a), b: detail(b), delta });
        } catch (err) {
          return {
            content: [{ type: "text", text: `Failed to fetch one or both products: ${err.message}` }],
            isError: true,
          };
        }
      },
    },
  ],
};
