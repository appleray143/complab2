# Laptop Lab Manager Online

**Developer: Raymond Apostol**

A GitHub-to-Cloudflare Pages project for online management of authorized school lab laptops. It includes:

- Responsive web dashboard at `/`
- Cloudflare Pages Functions API at `/api/...`
- Cloudflare D1 database for device state and chat
- Per-device random API tokens (only the token hash is stored in D1)
- Visible Windows Python client agent that checks in over HTTPS
- Remote time allowance updates, session pause/resume, and queued text messages
- Usage minutes based on recent keyboard/mouse input
- Optional recent URL reporting for Chrome/Edge; disabled by default
- GitHub commits trigger Pages deployment after initial setup

## Important behavior and limitations

This provides **scoped lab controls**, not unrestricted remote desktop access. The remote `Block` feature displays a visible full-screen pause notice on the managed laptop and pauses usage counting; it is not a tamper-proof Windows OS lock, cannot stop other applications completely, and can be bypassed by someone with sufficient access to close the agent. For reliable Windows-wide kiosk restrictions, use Windows Assigned Access / Intune / Group Policy on managed devices. There is no arbitrary shell, file browsing, keylogging, or hidden control feature.

The agent must be installed and running on each managed Windows laptop. Laptops need internet connectivity to communicate with the Cloudflare API. They poll about every 10 seconds, so remote changes are not instantaneous. Offline agents use their last cached allowance and block state. Chat messages queue until the agent reconnects. If all internet access is down, this Cloudflare-hosted control plane cannot reach the laptops.

URL collection is opt-in and disabled by default. Enable it only after notifying learners/staff and following school policy and applicable privacy requirements. The sample client supports reading the latest URL found in Chrome/Edge history databases; this is not a full web filter and will not reliably capture private/incognito sessions.

## Project structure

```text
public/                Static dashboard published by Cloudflare Pages
  index.html
  _headers
  assets/styles.css
  assets/app.js
functions/              Cloudflare Pages Functions API (not in public output)
  _lib.js
  api/admin/login.js
  api/admin/devices.js
  api/admin/devices/[id]/commands.js
  api/admin/devices/[id]/chat.js
  api/device/heartbeat.js
  api/device/poll.js
  api/device/ack.js
  api/device/chat.js
migrations/0001_init.sql D1 schema
agent/                  Windows client agent; not served as website assets
wrangler.toml           Cloudflare Pages + D1 configuration
```

## A. Deploy from GitHub to Cloudflare Pages

### 1. Create a GitHub repository

1. Download this project ZIP and extract it.
2. Create a **private** repository on GitHub, for example `laptop-lab-manager-online`.
3. Upload the *contents* of the extracted project folder to the repository root. Keep `public/`, `functions/`, `migrations/`, `agent/`, and `wrangler.toml` at the root.
4. Do **not** commit real passwords or `agent/agent_config.json` device tokens. `.gitignore` excludes the local agent config and state file.

### 2. Create the D1 database

Install Node.js LTS if needed, then open a terminal in the extracted project folder and run:

```bash
npx wrangler login
npx wrangler d1 create laptop-lab-manager
```

The second command prints a database ID. Open `wrangler.toml` and replace:

```toml
database_id = "REPLACE_WITH_D1_DATABASE_ID"
```

with the actual ID. Save, commit, and push the updated file to GitHub.

Apply the schema to the remote database:

```bash
npx wrangler d1 execute laptop-lab-manager --remote --file=migrations/0001_init.sql
```

If prompted, confirm that the target is your newly created `laptop-lab-manager` database. Keep the database name identical to `database_name` in `wrangler.toml`.

### 3. Connect the repository to Cloudflare Pages

1. Open [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Select **Workers & Pages** → **Create** → **Pages** → **Connect to Git** (labels may vary slightly).
3. Authorize GitHub and select your repository.
4. Use these build settings:

   | Setting | Value |
   |---|---|
   | Project name | `laptop-lab-manager-online` |
   | Production branch | `main` (or your actual default branch) |
   | Framework preset | None |
   | Build command | Leave blank / no build command |
   | Build output directory | `public` |
   | Root directory | Repository root |

5. If Cloudflare asks to configure the D1 binding in project settings, add **D1 database binding** with variable name `DB` and choose `laptop-lab-manager`. This must match `binding = "DB"` in `wrangler.toml`.
6. Deploy. The site gets a URL similar to `https://laptop-lab-manager-online.pages.dev`.

Only `public/` is the website output directory. The Python agent, SQL migrations, and Functions source do not get published as ordinary static files.

### 4. Configure secrets (required)

In Cloudflare Pages, open your project → **Settings** → **Variables and Secrets** (or Functions/Runtime variables). Add these as **secrets**, at least for the Production environment:

- `ADMIN_USERNAME`: your chosen admin username
- `ADMIN_PASSWORD`: a unique strong administrator password
- `SESSION_SECRET`: a random signing secret of at least 32 characters

Example to generate a session secret on a computer with Python:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Copy the generated value into Cloudflare as a secret. Do not put it in HTML, JavaScript, GitHub, or this README. Redeploy after changing function bindings/secrets if Cloudflare requests it.

Recommended additional hardening before real school use:

- In Cloudflare security/rate-limiting settings, add a rate limit to `/api/admin/login`.
- Use a private GitHub repository and protect the production branch.
- Restrict access to the Cloudflare account with multifactor authentication.
- Use a custom domain only after verifying the login, secrets, and Access policy. Optional Cloudflare Access can add a second identity gate.
- Back up/export the D1 database periodically and limit access to it.

### 5. Test the published dashboard

1. Open your new `https://...pages.dev/` URL.
2. Sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
3. Click **Add PC**. Set a unique PC number such as `PC-01` and its display name.
4. The dashboard creates a one-time device token. Copy it immediately. The raw token is not stored in the database, so it cannot be displayed again. If lost or exposed, use **Reset token** in that PC row, then replace the token in the matching laptop's `agent_config.json`; the old token stops working.

## B. Install the Windows client agent

### 1. Prepare one laptop first

1. Copy the entire `agent/` folder to an authorized Windows laptop, for example `C:\LaptopLabManagerAgent`.
2. Copy `agent_config.example.json` to `agent_config.json` in that folder.
3. Open `agent_config.json` in Notepad and configure it like this:

```json
{
  "server_url": "https://YOUR-PROJECT.pages.dev",
  "pc_number": "PC-01",
  "device_token": "PASTE_THE_ONE_TIME_TOKEN_FROM_ADMIN_DASHBOARD",
  "idle_counts_as_inactive_after_seconds": 120,
  "heartbeat_interval_seconds": 10,
  "track_recent_urls": false
}
```

Replace the server URL with your real Pages URL, PC number with the exact registered PC number, and token with that PC's one-time token from the dashboard. **Do not include `/admin` in `server_url`.**

4. Install Python 3.10+ on the laptop with Tkinter included (the standard Windows Python installer includes it).
5. Double-click `run_agent.bat`.
6. Keep its visible window open during the session. The PC should appear online in the dashboard after a successful check-in.

Repeat for each laptop with a unique PC number and matching, per-device token. Do not copy a token from PC-01 to PC-02.

### 2. Use optional URL reporting carefully

URL reporting is disabled by default. Only after appropriate notice/approval, change `track_recent_urls` to `true` in that client’s `agent_config.json` and restart the agent. It tries to report the latest visited URL in accessible Chrome/Edge history. It is not a browser extension or a real-time filter, and it does not guarantee that every visited page is recorded.

### 3. What the dashboard controls do

- **Set time**: choose a daily allowance in minutes (0–1440).
- **+10m / +30m / +60m**: increase the allowance by that number of minutes.
- **Block / Unblock**: show/remove a visible full-screen pause notice and change the server's managed-session state. A connected agent applies it on its next poll; a disconnected laptop applies new settings after reconnecting.
- **Chat**: send text to a client and view client replies. Messages queue while the client is offline.
- **Reset token**: revoke a PC's previous device token and issue a new one; update that laptop's `agent_config.json` immediately.
- **Status**: a client is shown online when its last check-in occurred within 45 seconds.
- **Usage**: count increments while the client is running and recent keyboard/mouse input has been detected. This is not a guarantee that every minute of powered-on time is counted.

## C. Update website files using GitHub

Edit `public/index.html`, `public/assets/styles.css`, or `public/assets/app.js`, then commit/push to the production branch. Cloudflare Pages redeploys automatically. Do not move `functions/` inside `public/`, because it needs to be deployed as Functions rather than served as downloadable source.

## D. Troubleshooting

- **Login says server setup incomplete**: add all three secrets (`ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET`) to the Pages Functions runtime settings and redeploy.
- **API says database missing**: confirm the D1 binding is named exactly `DB` and points to the database whose schema was initialized.
- **No devices appear**: add a PC in the dashboard first, then copy its one-time token into that laptop's `agent_config.json`.
- **Agent reports unauthorized**: the token may be wrong, for another PC, or the registration may have been removed; register a new device token.
- **Device offline**: ensure the agent is running, `server_url` is the actual Pages URL, the laptop has internet access, and the Windows clock is correct.
- **Changes appear delayed**: the agent polls about every 10 seconds; offline laptops cannot receive changes.
- **Python launcher not found**: install Python 3 and try `python client_agent.py` from the agent folder.

## E. Security and privacy notes

This is an initial working prototype. Before production deployment with student data, test with a few non-critical laptops first, set unique credentials, enable MFA on Cloudflare, establish backup/recovery, and have the school’s IT/privacy lead review it. Admin login sessions last up to 8 hours. Device credentials are unique and stored as hashes in D1, but a stolen client token should be revoked by deleting and recreating that device registration. All calls to the agent must use the HTTPS Pages URL.

It is not a remote desktop product and does not remotely view a user's screen, read files, or run arbitrary commands. The visible agent's session pause does not prevent use of other Windows apps. For operating-system level restrictions, manage the Windows devices using supported policies such as Assigned Access, Group Policy, or school MDM.
