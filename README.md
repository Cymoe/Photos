# Photo Lead Extractor

Upload photos of sign-up sheets, notebooks, business cards, or forms. Each photo is sent to
Claude, which reads off every prospect's **name, phone, email, address, city, state, zip** and any
notes. The leads land in a Convex database, where you can review, fix, dedupe, and export them to CSV.

## How it works

1. **Upload:** the browser shrinks each photo to at most 2000px JPEG (phone photos are often too big
   for the vision API) and uploads 4 at a time to Convex file storage.
2. **Extract:** each upload queues a Convex action (`convex/extract.ts`) that sends the image to
   `claude-opus-5-5` with a strict JSON schema and stores one row per person in the `leads` table.
   If the API rate-limits you during a big batch, the photo is automatically re-queued with a delay.
3. **Review:** the Leads tab updates live as photos finish. Click any cell to edit it, click the
   source filename to see the original photo, and rows sharing a phone number are highlighted as
   duplicates.
4. **Export:** use *Export CSV* or *Export (dedupe by phone)*. Either one opens cleanly in Excel or
   Google Sheets and can be imported into a CRM.

## Setup

You'll need Node 20+, a free [Convex](https://convex.dev) account, and an
[Anthropic API key](https://console.anthropic.com/).

```bash
npm install
npx convex dev            # log in, create a project; leave this running
```

In a second terminal, give the backend your Anthropic key (it lives in Convex, not in the browser):

```bash
npx convex env set ANTHROPIC_API_KEY sk-ant-...
npm run dev               # open http://localhost:5173
```

`npx convex dev` writes `VITE_CONVEX_URL` to `.env.local`, which is how the frontend finds your backend.

## Tips for ~300 photos

- Select them all at once in the file picker, or drag the whole folder's contents onto the drop zone.
- You can close the tab once the upload bar finishes. Extraction runs on the server.
- Check the **Photos** tab for any marked *error* and press **Retry failed**. Use *re-extract* on a
  photo if its leads look wrong.
- **HEIC (iPhone) photos:** Safari can read them directly. In Chrome, export as JPEG first, or set
  the iPhone to Settings → Camera → Formats → Most Compatible.
- Cost: roughly 1–3¢ per photo, depending on image size and how much is written on it.

## Deploying

```bash
npx convex deploy
npx convex env set ANTHROPIC_API_KEY sk-ant-... --prod
npm run build             # then host dist/ anywhere (Vercel, Netlify, …) with VITE_CONVEX_URL set
```
