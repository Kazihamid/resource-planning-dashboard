# Share the dashboard with your team using a Google Sheet (about 10 minutes, free)

No server, no IT help. Your team's data is kept in a Google Sheet that you own. Everyone who opens your invite link sees the same Project & Resource Register and the same **Deployed in Live** list, and both lists can also be read inside the Sheet.

## Do this once (the owner)

**Step 1 - Create the Sheet.** Go to https://sheets.google.com and create a blank spreadsheet. Name it, for example, `Resource Planning Data`.

**Step 2 - Add the script.**
1. In the Sheet, click **Extensions > Apps Script**.
2. Delete everything in the editor.
3. Open `google-sheet/Code.gs` from this folder in Notepad, select all, copy, and paste it into the editor.
4. Near the top, find the line `const EDIT_KEY = 'CHANGE-ME-to-your-own-secret-word';` and replace the text between the quotes with your own secret word of at least 8 letters/numbers. This is your team's password. Keep the quotes.
5. Click the **Save** (disk) icon.

**Step 3 - Publish it.**
1. Click **Deploy > New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**.
4. Click **Deploy**, then **Authorize access**, and choose your Google account.
5. Google says "Google hasn't verified this app". This is your own script, so click **Advanced**, then **Go to ... (unsafe)**, then **Allow**.
6. Copy the **Web app URL** (it ends in `/exec`).

**Step 4 - Connect the dashboard.**
1. Open the dashboard, then **Setup > Google Sheet sharing**.
2. Paste the Web app URL, type your secret word in **Access key**, type your name, and click **Connect**.
3. The page reloads. The top badge should read `Your name - Editor - Shared plan v1`, and the Sheet now has tabs **Project Register** and **Deployed in Live**.

**Step 5 - Load your real data.** Still in Setup, click **Import Project Register** and choose your Excel file (use `templates/Project_Register_Template_v3.xlsx` as the layout). Fix anything it reports, import, then click **Update Source Baseline**. This replaces the demo data for everybody.

**Step 6 - Invite your team.** In Setup > Google Sheet sharing click **Copy invite link** and send it to your team. Each person opens the link once, types their name, and is connected from then on (this browser remembers it).
- The link opens the dashboard page you are using now. If you open the dashboard as a file on your own computer, the link only works on your computer. Put the dashboard where everyone can reach it (for example your GitHub Pages address, or a shared folder) and use the invite link from there. Or send teammates the `index.html` file and tell them to paste the invite link into **Setup > Google Sheet sharing > Web app URL** and click Connect.

## Everyday use
- Edit as before. Changes are saved to the Sheet automatically and other people see them within about 20 seconds.
- Set a project's Project Status to **Deployed in Live** and it moves to the Deployed in Live list for everyone.
- **Setup > Change History** shows who changed what, and lets you restore one of the last 40 versions.
- If two people add the same JIRA ID at the same moment, the second is refused and told why.

## Good to know
- **Read-only people:** in the script set `VIEW_KEY` to a second secret word, save, and deploy a new version. Then **Copy view-only link** (owner only) gives a link that can look but not change.
- **Changing the script later** needs **Deploy > Manage deployments > pencil icon > Version: New version > Deploy**. The URL stays the same.
- **Who can see the data:** anyone who has the invite link (it contains the access key). Share it only with your team. To lock everyone out, change `EDIT_KEY`, deploy a new version and send a new link.
- **Names are self-entered** (no passwords per person), so Change History shows the name typed, not a verified identity.
- **Tabs starting with _** are the dashboard's own storage and are hidden. Please don't edit them. The two readable tabs are overwritten on every save; make changes in the dashboard.
- **Backup:** use Save Plan now and then, or File > Make a copy in Google Sheets.
- Google limits apply (many saves per minute by many people can slow things down); a team of 5-15 people is fine.
