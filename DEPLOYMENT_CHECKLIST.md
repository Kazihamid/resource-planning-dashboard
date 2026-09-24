# Deployment Checklist

## Before deployment
- [ ] `index.html` opens locally
- [ ] Project Register loads
- [ ] Resource View buttons work
- [ ] Load Forecast / Heatmap works
- [ ] Gantt works
- [ ] Import Excel/CSV works
- [ ] Save Plan / Load Plan works
- [ ] Auto-Save works
- [ ] Reset to Source works
- [ ] Export PDF menu works
- [ ] Gantt PDF export works

## IIS
- [ ] Static Content installed
- [ ] Site points to this folder
- [ ] HTTPS binding configured if required
- [ ] Internal access permissions verified

## Shared live plan (IIS + Node.js, README Option D)
- [ ] Node.js 22.13+ installed; URL Rewrite + ARR installed; ARR proxy enabled
- [ ] `HTTP_X_REMOTE_USER` added to allowed server variables
- [ ] `server\config.json` created with `authMode: "iis"`, `host: 127.0.0.1` and the editor list
- [ ] Scheduled task runs `server.js` at startup under a service account that can write `server\data`
- [ ] IIS site points at the folder that holds only `server\iis\web.config`
- [ ] Windows Authentication enabled, Anonymous Authentication disabled
- [ ] Header badge shows `DOMAIN\user · Editor` for an editor and `· Viewer` for a non-editor
- [ ] A change by one editor appears for a second user within 15 seconds
- [ ] Setup → Change History lists the change with the right user
- [ ] Daily `npm run backup` scheduled

## GitHub Pages / Netlify
- [ ] Data is approved for internet hosting
- [ ] `index.html` is at site root
- [ ] Public-access implications reviewed
