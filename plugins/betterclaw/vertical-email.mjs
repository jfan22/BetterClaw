// Email vertical — wraps @gongrzhe/server-gmail-autoauth-mcp as a child process.
// Owns the MCP proxy lifecycle via GmailMcpClient.

import { Type } from "@sinclair/typebox";
import { GmailMcpClient } from "./gmail-client.mjs";

const gmail = new GmailMcpClient();
const proxy = (childToolName) => async (_id, params) => gmail.callTool(childToolName, params);

export const vertical = {
  id: "email",
  description: "Read + search + draft Gmail via a scoped MCP child process.",
  guidance_for_compiler: `
AVAILABLE TOOLS — pick only from this list:
- gmail_search: search/list emails using Gmail query syntax (e.g. "in:inbox", "from:alice@example.com", "is:unread")
- gmail_read: read one email's full content by message ID
- gmail_draft: create a draft reply (never sends)

RULES:
1. The entry node's allowed_tools MUST include "gmail_search" (every workflow starts by listing).
2. Reading a specific email ("gmail_read") must come after searching ("gmail_search").
3. Drafting ("gmail_draft") must come after reading.
`.trim(),
  tools: [
    {
      name: "gmail_search",
      description:
        "Search Gmail messages. Use Gmail query syntax, e.g. 'in:inbox' for inbox, 'from:alice@example.com', 'is:unread'. Returns message IDs + metadata.",
      parameters: Type.Object({
        query: Type.String({ description: "Gmail search query" }),
        maxResults: Type.Optional(
          Type.Number({ default: 5, description: "Max results (default 5)" }),
        ),
      }),
      execute: proxy("search_emails"),
    },
    {
      name: "gmail_read",
      description:
        "Read the full body, headers, and attachment metadata of one email by message ID. Use IDs returned by gmail_search.",
      parameters: Type.Object({
        messageId: Type.String({ description: "Gmail message ID" }),
      }),
      execute: proxy("read_email"),
    },
    {
      name: "gmail_draft",
      description:
        "Create a Gmail DRAFT. Does not send. Use this when the workflow allows replying.",
      parameters: Type.Object({
        to: Type.Array(Type.String(), { description: "Recipient addresses" }),
        subject: Type.String(),
        body: Type.String(),
        cc: Type.Optional(Type.Array(Type.String())),
        bcc: Type.Optional(Type.Array(Type.String())),
        threadId: Type.Optional(Type.String({ description: "Reply thread ID" })),
        inReplyTo: Type.Optional(Type.String({ description: "Message ID being replied to" })),
      }),
      execute: proxy("draft_email"),
    },
  ],
};
