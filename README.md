# Project Status and Resource Engagement Plan Dashboard

Deployment-ready static web package for the **Project Status and Resource Engagement Plan Dashboard**.

## Package contents

```text
resource-planning-dashboard/
├── index.html
├── favicon.svg
├── site.webmanifest
├── .nojekyll
├── netlify.toml
├── web.config
├── README.md
├── templates/
│   └── Demo_Project_Register_Template.xlsx
└── server/                      ← optional shared live plan (Option D)
    ├── server.js                  Node.js server: API, SQLite storage, change history
    ├── backup.js                  consistent database backup
    ├── config.example.json        copy to config.json and list the editors
    ├── package.json               npm start / npm run backup (no dependencies)
    └── iis/web.config             IIS front end: Windows sign-in + forwarding to Node
```

The dashboard is a standalone browser application. No application server, database, Python, Node.js, or Excel installation is required for the current feature set.

## Current features retained

- Project & Resource Register
- Resource reassignment and roles
- Resource load forecast and heatmap
- Project-resource Gantt
- Overlap/conflict forecast
- Project Register Excel/CSV import and validation
- Save Plan / Load Plan JSON
- Browser Auto-Save
- Maintained Source Baseline / Reset to Source
- PDF reporting, including Gantt PDF
- CSV export
- Demo Project Register template

## Important data behavior when hosted

Hosting the HTML provides one shared URL, but the current **Auto-Save** and maintained **Source Baseline** use browser local storage.

This means:
- each user/browser has its own local working state;
- updating Source Baseline on one computer does not automatically update another user's browser;
- Save Plan JSON is the portable way to share a complete planning state;
- Import Project Register is the portable way to load a common register;
- for one central live dataset that all users edit, use **Option D — Shared live plan** below.

## Local test

Open `index.html` in a modern Microsoft Edge or Google Chrome browser.

For a more realistic local web-server test:

```powershell
cd path\to\resource-planning-dashboard
py -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

---

# Option A — IIS / Internal Organization Server

**Recommended for confidential internal project/resource data.**

1. Copy the entire `resource-planning-dashboard` folder to the Windows server, for example:

   ```text
   C:\inetpub\wwwroot\ResourcePlanningDashboard
   ```

2. Make sure the IIS Web Server role is installed with **Static Content** enabled.

3. Open **Internet Information Services (IIS) Manager**.

4. In **Connections**, right-click **Sites** → **Add Website**.

5. Enter:
   - **Site name:** `ResourcePlanningDashboard`
   - **Physical path:** the folder containing `index.html`
   - **Binding:** choose the organization-approved port/host name.

6. Start the site.

7. Open the assigned URL, for example:

   ```text
   https://resource-dashboard.yourcompany.local/
   ```

8. For HTTPS, add the organization's TLS certificate and HTTPS binding in IIS.

9. Restrict access using your organization's normal network/IIS controls if the site is internal.

`web.config` is included and sets `index.html` as the default document.

Microsoft IIS reference:
- https://learn.microsoft.com/en-us/iis/manage/creating-websites/scenario-build-a-static-website-on-iis
- https://learn.microsoft.com/en-us/iis/get-started/getting-started-with-iis/create-a-web-site

---

# Option B — GitHub Pages

Use this only when the dashboard/data is appropriate for internet publishing.

> **Security warning:** GitHub Pages sites are publicly available on the internet. Do not publish confidential project/resource data there unless your organization's security policy explicitly permits it.

1. Create a GitHub repository.

2. Upload the **contents** of this package to the repository root so `index.html` is at the top level.

3. Commit/push the files to `main`.

4. On GitHub open:

   **Repository → Settings → Pages**

5. Under **Build and deployment**:
   - Source: **Deploy from a branch**
   - Branch: **main**
   - Folder: **/(root)**

6. Click **Save**.

7. After deployment, use **Visit site** from the Pages settings.

The included `.nojekyll` prevents Jekyll processing from changing the static package.

Official GitHub documentation:
- https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

---

# Option C — Netlify

Suitable for quick static deployment. Confirm organizational security requirements before publishing internal data.

## Fastest method: Netlify Drop

1. Sign in to the correct Netlify team.

2. Open:

   ```text
   https://app.netlify.com/drop
   ```

3. Drag the **entire `resource-planning-dashboard` folder** into the deploy area.

4. Netlify publishes the static site and gives you a `netlify.app` URL.

5. To update the site later, replace files locally and drag the updated folder to the site's deploy area.

The included `netlify.toml` requires no build process and publishes the package root.

Official Netlify documentation:
- https://docs.netlify.com/start/quickstarts/netlify-drop-quickstart/
- https://docs.netlify.com/deploy/create-deploys/

---

# Option D — Shared live plan (IIS + Node.js server)

Use this when several managers must see and edit **one central plan**. The same `index.html` detects the server automatically:

| Opened from | Behaviour |
|---|---|
| `server/server.js` (directly or behind IIS) | **Shared plan.** Every editor's change is saved to the server within a second and appears on other screens within 15 seconds. A badge in the header shows who you are, your role and the shared version. |
| A file, GitHub Pages, Netlify, or plain IIS static hosting | The original browser-only behaviour (local Auto-Save, Save/Load Plan JSON). |

What the server adds:

- **Sign-in** with the user's Windows domain account through IIS Windows Authentication, so there are no separate passwords.
- **Editors and viewers.** People listed in `server/config.json` can save changes. Everyone else who can sign in can view the plan and try what-ifs, but their changes stay in their own browser tab and are never saved.
- **Change History** (in Setup): every save records who made it, when, and which rows and fields changed (old value → new value). Editors can **restore** any stored version, and the restore is itself recorded.
- **Simultaneous editing.** If two editors change *different* rows at the same time, both changes are merged. If they change the *same* row, the later save is rejected, that user sees the latest plan and a message, and nothing is overwritten silently.
- Filters, timeline and thresholds remain personal to each user.
- One database file, `server/data/dashboard.db` (SQLite), with no database server to install.

## Try it on your own PC

Requires Node.js 22.13 or later (no `npm install` is needed).

```powershell
cd path\to\resource-planning-dashboard\server
npm start
```

Open `http://localhost:3000`. Without a `config.json`, the server runs in **dev mode**: only this PC can reach it and you are the only user (an editor). The first time an editor opens the dashboard against an empty database, that browser's current plan is published as version 1.

## Install on the IIS server

Needs Windows administrator rights on the server.

1. **Install** on the server:
   - Node.js 22 LTS (https://nodejs.org)
   - IIS with **Windows Authentication** (Server Manager → Web Server → Security → Windows Authentication)
   - IIS **URL Rewrite** and **Application Request Routing (ARR)** modules (https://www.iis.net/downloads/microsoft/url-rewrite, https://www.iis.net/downloads/microsoft/application-request-routing)

2. **Copy** the whole `resource-planning-dashboard` folder to, for example, `C:\Apps\ResourcePlanningDashboard`.

3. **Configure**: copy `server\config.example.json` to `server\config.json` and set the editors (`DOMAIN\username`, not case-sensitive; `"*"` makes everyone an editor):

   ```json
   {
     "host": "127.0.0.1",
     "port": 3000,
     "authMode": "iis",
     "editors": ["DOMAIN\\your.name", "DOMAIN\\another.manager"],
     "dbPath": "data/dashboard.db",
     "keepVersions": 1000
   }
   ```

   Editor changes take effect without a restart. Keep `host` as `127.0.0.1`: the server trusts the user name that IIS forwards, so only IIS may be able to reach it. The server refuses to start in `iis` mode on any other address.

4. **Run the server at startup.** Use a service account that can write to `server\data`. With built-in Task Scheduler (PowerShell as administrator):

   ```powershell
   $node = (Get-Command node).Source
   $action  = New-ScheduledTaskAction -Execute $node -Argument '--disable-warning=ExperimentalWarning server.js' -WorkingDirectory 'C:\Apps\ResourcePlanningDashboard\server'
   $trigger = New-ScheduledTaskTrigger -AtStartup
   $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
   Register-ScheduledTask -TaskName 'ResourcePlanningDashboard' -Action $action -Trigger $trigger -Settings $settings -User 'DOMAIN\svc-account' -Password '<password>' -RunLevel Limited
   Start-ScheduledTask -TaskName 'ResourcePlanningDashboard'
   ```

   Check it with `Invoke-WebRequest http://127.0.0.1:3000/ -UseBasicParsing` on the server.

5. **Allow IIS to forward the user name** (once per server, administrator command prompt):

   ```bat
   %windir%\system32\inetsrv\appcmd.exe set config -section:system.webServer/proxy /enabled:"True" /commit:apphost
   %windir%\system32\inetsrv\appcmd.exe set config -section:system.webServer/rewrite/allowedServerVariables /+"[name='HTTP_X_REMOTE_USER']" /commit:apphost
   ```

6. **Create the IIS site**:
   - Create an **empty** folder, for example `C:\inetpub\ResourcePlanningDashboard`, and copy `server\iis\web.config` into it. The site points at this folder, not at the app folder, so IIS can never serve `config.json` or the database directly.
   - IIS Manager → Sites → **Add Website** → physical path = that folder, with the organization's host name and HTTPS binding.
   - Site → **Authentication**: **Windows Authentication = Enabled**, **Anonymous Authentication = Disabled**.

7. **Verify**: open the site URL. The header badge must show `DOMAIN\your.name · Editor · Shared plan v…`. If the page says *"Shared plan sign-in failed: Not signed in"*, Windows Authentication is not enabled or the user name is not being forwarded (check steps 5–6).

## Backups

The database is a single file. Take a consistent copy while the server is running:

```powershell
cd C:\Apps\ResourcePlanningDashboard\server
npm run backup            # writes server\backups\dashboard_YYYY-MM-DD_HHMM.db
```

Schedule this daily in Task Scheduler and keep the backups folder on backed-up storage. To restore a backup, stop the task, replace `server\data\dashboard.db` with the backup copy, then start the task again. For mistakes inside the plan, **Change History → Restore** is quicker.

## Updating the shared-plan installation

Replace `index.html` and the `server` folder's `.js` files, but **keep `server\config.json` and `server\data\`**, then restart the scheduled task.

---

# Updating the hosted dashboard

When a new dashboard HTML version is created:

1. Keep a backup of the current deployed folder.
2. Replace `index.html` with the new dashboard HTML.
3. Keep `favicon.svg`, configuration files, and README unless they also changed.
4. Redeploy/copy the package.
5. Test:
   - dashboard opens;
   - Setup opens;
   - resource filters work;
   - Excel/CSV import works;
   - Save/Load Plan works;
   - Auto-Save works;
   - Reset to Source works;
   - PDF exports work;
   - Gantt PDF works.

## Recommended production approach

For organizational use, the preferred deployment is:

```text
Internal IIS / Intranet
        ↓
One dashboard URL
        ↓
Users' browsers
```

When all users need to see and edit one central live plan, use **Option D** (shared live plan) instead of browser local storage.

## Browser support

Use a current version of:
- Microsoft Edge
- Google Chrome

Modern browser features are used for local storage, file import, downloadable JSON/CSV/PDF files, and Excel parsing.
