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
└── templates/
    └── Demo_Project_Register_Template.xlsx
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
- a future backend/database is required if all users must edit one central live dataset.

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

If you later need all users to see and edit one central live plan, add a small API/database layer rather than relying on browser local storage.

## Browser support

Use a current version of:
- Microsoft Edge
- Google Chrome

Modern browser features are used for local storage, file import, downloadable JSON/CSV/PDF files, and Excel parsing.
