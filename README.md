# RES Daily Site Reports

Mobile-first web app for Rhino Energy Solutions field teams to submit daily site reports from any phone or computer.

## What it does

- Field teams open the app on their phone, enter a PIN, and fill in the daily report
- A Word document (.docx) matching the official RES template is generated automatically
- The docx + photos are saved to each team member's OneDrive folder via a lightweight sync helper
- Works offline — submissions are queued and sync automatically when connectivity is restored

## Architecture

```
Phone (anywhere) → Render.com (Node/Express) → Supabase (DB + Storage)
                                                      ↓ polled every 60s
                                              Sync Helper (laptop)
                                                      ↓
                                              OneDrive folder → other laptops
```

## Stack

| Layer | Choice |
|---|---|
| Hosting | Render.com (free Web Service) |
| Backend | Node.js + Express |
| Database + Storage | Supabase (free tier) |
| Frontend | Vanilla HTML/CSS/JS (PWA) |
| DOCX generation | `docx` npm package |
| Sync helper | Python 3 |

**Total cost: $0/month.**

## Setup

See [SETUP.md](./SETUP.md) for the full step-by-step deployment guide (~20 minutes).

## Repository structure

```
res-site-reports/
├── server/              Node.js backend (deploys to Render)
│   ├── routes/          API route handlers
│   ├── lib/             DOCX generator, filename utils, Friday logic
│   └── supabase-schema.sql
├── public/              Frontend (PWA)
│   ├── index.html       Project picker + PIN entry
│   ├── report.html      Daily report form
│   └── admin.html       Admin panel
└── sync-helper/         Python script that downloads files to OneDrive
    ├── res_sync.py
    └── install-windows.bat
```

## Security

- All PINs stored as bcrypt hashes (cost 12)
- Rate-limited login endpoints (5–10 req/min/IP)
- HTTPS enforced (Render provides automatically)
- Sync API protected by long random key
- No user-uploaded code accepted (images only)
- Full audit log of IP addresses and sync activity

## Development

```bash
cd server
cp .env.example .env
# Edit .env with your Supabase credentials
npm install
npm run dev
```

App runs on `http://localhost:3000`.
