# Radiology AI Typist (MVP)

Draft radiology findings from a single audio dictation, with editable output and client-side export.

## Features
- Template-scoped findings generation via Google Gemini
- One-take audio recording or upload
- Editable findings editor (textarea-like)
- Copy full text, export .docx, export PDF
- Flags + disclaimer shown under the editor
- In-memory processing with basic rate limiting

## Setup
1) Install dependencies
```bash
npm install
```

2) Create `.env.local`
```bash
cp .env.example .env.local
```
Add your API key:
```
GEMINI_API_KEY=your_key_here
```

3) Run the app
```bash
npm run dev
```
Open `http://localhost:3000`.

## Deployment (Vercel)
1) Push this repo to GitHub.
2) In Vercel, import the repo.
3) Add the `GEMINI_API_KEY` environment variable.
4) Deploy.

### Custom Domain
1) In Vercel project settings, open **Domains**.
2) Add your domain and follow DNS instructions.

## Notes
- No database or auth; audio is processed in-memory only.
- Audio limits: 5 minutes or 12MB.
- Gemini is instructed to return JSON only with observations, flags, and disclaimer.
- Debugging: set `DEBUG_GEMINI_LOG=true` to log raw Gemini output on the server; set `DEBUG_GEMINI_CLIENT=true` to include the raw model output in API error responses.
- GitHub Pages: not supported for the Gemini-backed app (requires a server route + secret API key). Use Vercel/Netlify/Render, or host the API separately and keep Pages as UI-only.
