# Photo Lead Extractor

Upload screenshots or photos of lead messages (CRM notifications, form submissions, SMS). The app
reads the text **in your browser, for free** (no AI account or API key) and pulls out each
prospect's **name, phone, email, address, city, state, zip**, plus any form answers as notes. Leads are saved
in a Convex database, where you can review, fix, dedupe, and export them to CSV.

## How it works

1. **Read:** each photo is resized and run through [Tesseract.js](https://tesseract.projectnaptha.com/)
   text recognition on your device. The English model (~10 MB) downloads once, then is cached.
2. **Parse:** `src/parseLead.ts` finds labeled fields ("Name:", "Full name:", "Phone number:",
   "Email:", "Address:", ...), falls back to any phone/email in the text, skips system lines like
   "Using +1 ... to send SMS", and splits addresses into street/city/state/zip.
3. **Save:** the image goes to Convex file storage and the lead to the `leads` table.
4. **Pipeline:** the *Pipeline* tab is a board (New → Contacted → Estimate Scheduled → Estimate
   Sent → Won / Lost), newest leads at the top of every column. Drag a card by ⠿ (works with a
   finger) or pick a stage from its menu; add your own follow-up notes; tap phone/email/address to
   call, email or open Maps. Screenshots of the same person are merged into one card, and the banner
   shows the newest lead's date so you can tell whether the latest leads are in.
5. **Review & export:** edit any cell, tap the source filename to see the photo, spot duplicate phone
   numbers, and export a CSV (optionally deduped by phone).

Works best on screenshots and printed text; handwriting is not reliable with OCR.

## Setup (local)

```bash
npm install
npx convex dev            # log in, create a project; leave this running
npm run dev               # open http://localhost:5173
```

## Tips for ~300 photos

- Select them all at once. **Keep the page open** until the progress bar finishes, because the reading
  happens on your device.
- Photos where no contact details were found are marked *error* on the **Photos** tab; open them,
  and add the lead by hand if needed.
- **HEIC (iPhone) photos:** Safari reads them directly. In Chrome, export as JPEG first.

## Deploying to Vercel (works entirely from a browser / iPad)

`vercel.json` sets the build command to `npx convex deploy --cmd 'npm run build'`, which pushes the
Convex backend and builds the site with the right `VITE_CONVEX_URL` in one step.

1. **Convex:** at [dashboard.convex.dev](https://dashboard.convex.dev), create a project. Switch to its
   **Production** deployment, go to *Settings → General*, and generate a **Production deploy key**.
2. **Vercel:** at [vercel.com/new](https://vercel.com/new), import this GitHub repo. Under
   *Environment Variables*, add `CONVEX_DEPLOY_KEY` with the key from step 1, then deploy.

Every push to the repo redeploys both the site and the backend.
