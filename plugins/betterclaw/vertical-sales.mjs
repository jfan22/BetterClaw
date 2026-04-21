// Sales vertical — lead gen + outreach. Stub catalog for v1; replace with a
// real CRM MCP (HubSpot, Salesforce, Apollo) when moving past the demo stage.
// Outreach piggybacks on the email vertical — sales_send_outreach is effectively
// a prebuilt gmail_draft with personalization.

import { Type } from "@sinclair/typebox";

const FAKE_LEADS = [
  { id: "L-001", name: "Sarah Chen",   title: "VP Ops",       company: "Acme Logistics",  employees: 50,  industry: "Logistics",   email: "sarah@acme.test",    signal: "Hired 2 ops managers last month" },
  { id: "L-002", name: "Marcus Patel", title: "Founder",      company: "Brightside Labs", employees: 12,  industry: "BioTech",     email: "marcus@brightside.test", signal: "Seed round announced" },
  { id: "L-003", name: "Yusuf Rahman", title: "Head of Sales", company: "Helm",            employees: 85,  industry: "SaaS",        email: "yusuf@helm.test",    signal: "CRM migration ad on LinkedIn" },
  { id: "L-004", name: "Ana Oliveira", title: "COO",          company: "Feldspar",        employees: 230, industry: "Manufacturing", email: "ana@feldspar.test",  signal: "New plant in Ohio" },
  { id: "L-005", name: "Devin Cole",   title: "Operations",   company: "Unison Delivery", employees: 40,  industry: "Logistics",   email: "devin@unison.test",  signal: "Posted 3 driver jobs" },
];

const toolText = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });

export const vertical = {
  id: "sales",
  description: "Prospect leads + send personalized outreach drafts (stub catalog in v1).",
  guidance_for_compiler: `
AVAILABLE TOOLS — pick only from this list:
- sales_find_leads: filter a lead catalog by criteria; returns list of matches
- sales_enrich: fetch more detail (recent signals, role, company info) for one lead
- sales_draft_outreach: compose a personalized outreach email draft for one lead (does NOT send — only drafts)

RULES:
1. The entry node's allowed_tools MUST include "sales_find_leads".
2. Enriching ("sales_enrich") must come after finding leads.
3. Drafting outreach ("sales_draft_outreach") must come after enriching — never blind-spam without reading the lead's signal.
`.trim(),
  tools: [
    {
      name: "sales_find_leads",
      description:
        "Filter the lead catalog. Pass industry, min/max employees, or a keyword that matches title/signal. Returns ids + summary fields.",
      parameters: Type.Object({
        industry: Type.Optional(Type.String()),
        minEmployees: Type.Optional(Type.Number()),
        maxEmployees: Type.Optional(Type.Number()),
        keyword: Type.Optional(Type.String()),
        maxResults: Type.Optional(Type.Number({ default: 5 })),
      }),
      async execute(_id, params) {
        const kw = (params.keyword || "").toLowerCase();
        const matches = FAKE_LEADS.filter((L) => {
          if (params.industry && L.industry !== params.industry) return false;
          if (params.minEmployees != null && L.employees < params.minEmployees) return false;
          if (params.maxEmployees != null && L.employees > params.maxEmployees) return false;
          if (kw && !`${L.title} ${L.signal}`.toLowerCase().includes(kw)) return false;
          return true;
        });
        const summary = matches.slice(0, params.maxResults ?? 5).map((L) => ({
          id: L.id,
          name: L.name,
          title: L.title,
          company: L.company,
          industry: L.industry,
          employees: L.employees,
        }));
        return toolText({ total_matches: matches.length, results: summary });
      },
    },
    {
      name: "sales_enrich",
      description: "Fetch full detail for one lead (title, company, industry, employees, recent signal, email).",
      parameters: Type.Object({ leadId: Type.String() }),
      async execute(_id, params) {
        const L = FAKE_LEADS.find((x) => x.id === params.leadId);
        if (!L) return { content: [{ type: "text", text: `No lead with id ${params.leadId}` }], isError: true };
        return toolText(L);
      },
    },
    {
      name: "sales_draft_outreach",
      description:
        "Draft a personalized outreach email to a specific lead. Agent must pass a body that references the lead's signal (demonstrates you read the context).",
      parameters: Type.Object({
        leadId: Type.String(),
        subject: Type.String(),
        body: Type.String({ description: "Draft body — must reference the lead's signal" }),
      }),
      async execute(_id, params) {
        const L = FAKE_LEADS.find((x) => x.id === params.leadId);
        if (!L) return { content: [{ type: "text", text: `No lead with id ${params.leadId}` }], isError: true };
        return toolText({
          draft: {
            to: L.email,
            subject: params.subject,
            body: params.body,
            references_signal: L.signal.toLowerCase().split(/\s+/).some((w) => params.body.toLowerCase().includes(w)),
          },
          lead: { id: L.id, name: L.name, company: L.company },
          note: "This is a stub — in production this would proxy to a real email MCP.",
        });
      },
    },
  ],
};
