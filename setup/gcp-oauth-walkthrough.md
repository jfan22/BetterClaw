# Google Cloud OAuth Walkthrough

Creates OAuth 2.0 credentials for a **throwaway Gmail account** so the Gmail MCP server can read/draft mail. ~5 minutes.

## Prerequisites

- A throwaway Gmail account (sign up at https://accounts.google.com/SignUp if you haven't).
- Signed in as that account in your browser.

## Steps

### 1. Create a Google Cloud project

- Go to https://console.cloud.google.com/
- Top-left project dropdown → **New Project**
- Name: `BetterClaw Dev` (or anything)
- Click **Create**. Wait ~10s for provisioning. Dropdown will select the new project automatically (if not, select it).

### 2. Enable the Gmail API

- Nav: **APIs & Services** → **Library**
- Search "Gmail API" → click the result → **Enable**

### 3. Configure OAuth consent screen

- Nav: **APIs & Services** → **OAuth consent screen**
- User type: **External** → Create
- Fill in the minimum:
  - App name: `BetterClaw Dev`
  - User support email: your throwaway Gmail
  - Developer contact: your throwaway Gmail
- Click **Save and continue** through Scopes (leave empty — API scopes are requested at runtime), Test users, Summary.
- Back on the consent-screen page, under **Test users**, add your throwaway Gmail as a test user. (While the app is in "Testing" mode, only listed test users can OAuth in. We want this — it blocks accidental cross-account use.)

### 4. Create OAuth credentials

- Nav: **APIs & Services** → **Credentials**
- **+ Create Credentials** → **OAuth client ID**
- Application type: **Desktop app**
- Name: `BetterClaw Desktop`
- Click **Create**
- A dialog pops up with your client ID + secret. Click **Download JSON** (top-right download icon).
- The file will be named something like `client_secret_XXXX.apps.googleusercontent.com.json`.

### 5. Place the keys file

Rename and move:

```bash
mv ~/Downloads/client_secret_*.apps.googleusercontent.com.json ~/.gmail-mcp/gcp-oauth.keys.json
ls -la ~/.gmail-mcp/
```

You should see `gcp-oauth.keys.json` in there.

### 6. Run the auth flow

```bash
npx @gongrzhe/server-gmail-autoauth-mcp auth
```

This will:
- Open your default browser
- Route you through Google's OAuth consent screen (you'll see a warning "Google hasn't verified this app" — click **Advanced** → **Go to BetterClaw Dev (unsafe)** — this is expected for unpublished apps)
- Grant permissions (read, send, modify)
- Write `~/.gmail-mcp/credentials.json`

When the browser shows "Auth completed," close the tab. The terminal command should exit cleanly.

### 7. Come back to the terminal

Tell the agent: "OAuth done, credentials.json is there." It will do steps 7-10 of the README checklist.

## Troubleshooting

**"Error 403: access_denied"** — Your throwaway Gmail isn't in the Test users list. Go back to step 3 and add it.

**"redirect_uri_mismatch"** — You picked "Web application" instead of "Desktop app" in step 4. Delete the credential, create a new one as "Desktop app."

**Browser didn't open** — The `auth` command prints a URL to the terminal. Copy/paste it into a browser manually.
