# RES Daily Site Reports — Setup Guide

This guide walks you through deploying the app for the first time. Takes ~20 minutes.

## Part 1: Supabase Setup (5 min)

1. Go to https://supabase.com and sign up (free).
2. Create a new project. Name it `res-site-reports`. Pick a strong database password.
3. Wait for the project to provision (~2 min).
4. Open the **SQL Editor** (left sidebar).
5. Open `server/supabase-schema.sql` in this repo. Copy its entire contents.
6. Paste into the SQL Editor and click **Run**.
7. Go to **Project Settings → API**. Copy these two values:
   - **Project URL** (e.g., `https://abcdefg.supabase.co`)
   - **service_role secret** (NOT the anon key — the `service_role` one)
   - Keep them safe; you'll paste them into Render.

## Part 2: Render Setup (8 min)

1. Push this repo to your GitHub account (create a new repo, push the code).
2. Go to https://render.com and sign up (free).
3. Click **New +** → **Web Service**.
4. Connect your GitHub and select the repo.
5. Settings:
   - **Name**: `res-reports`
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
6. Add these **Environment Variables** (Environment tab):

   | Key | Value |
   |---|---|
   | `SUPABASE_URL` | From Part 1 |
   | `SUPABASE_SERVICE_KEY` | From Part 1 (service_role key) |
   | `ADMIN_PIN` | A strong PIN you choose — this lets you add projects |
   | `SYNC_API_KEY` | Run `openssl rand -hex 32` in a terminal, or use a long random string |
   | `TZ` | `Africa/Johannesburg` |

7. Click **Create Web Service**. Wait ~3 min for it to build and deploy.
8. Your app URL will be like `https://res-reports.onrender.com`.

## Part 3: Add Your First Project (2 min)

1. Open `https://res-reports.onrender.com/admin.html`
2. Log in with the `ADMIN_PIN` you set.
3. Click **Add Project**. Enter:
   - **Name**: `Balwin Greenpark` (or the actual site name)
   - **ID**: `balwin-greenpark` (auto-generated from name, lowercase + hyphens)
   - **PIN**: a 4–8 digit code for that site's team
4. Click **QR Code** next to the project — print this and bring it to site.
5. Done. Team members can now scan the QR code or go to `https://res-reports.onrender.com` and pick the project.

## Part 4: Sync Helper on Your Laptop (5 min)

1. Open the `sync-helper` folder.
2. Copy `config.example.json` to `config.json`.
3. Edit `config.json`:
   - `api_base_url`: your Render URL
   - `sync_api_key`: the same `SYNC_API_KEY` from Render env vars
   - `onedrive_base_path`: your full OneDrive path for reports (e.g. `C:\Users\BenedictLefoka\OneDrive - Rhino Energy Solutions (Pty) Ltd\Documents\Daily site reports`)
   - `laptop_id`: a unique name for your laptop (e.g. `benedict-laptop`)
4. Right-click `install-windows.bat` → **Run as administrator**.
5. Done. The sync helper will run in the background, downloading new submissions to your OneDrive folder within 60 seconds of each submission.

## Adding Another Team Member

To let a teammate receive reports on their laptop:

1. Send them the `sync-helper` folder.
2. They copy `config.example.json` to `config.json` and edit:
   - Same `api_base_url` and `sync_api_key` as yours
   - Their own `onedrive_base_path` (their OneDrive root)
   - A unique `laptop_id` (e.g. `john-laptop`)
3. They run `install-windows.bat`.
4. Done. The script auto-creates the folder structure if it doesn't exist.

## File / Folder Structure Created

```
{OneDrive base}/
└── Balwin Greenpark/
    └── 2026-03-03/
        ├── RES_Daily_Site_Report_BalwinGreenpark_03-03-2026.docx
        ├── photo_1.jpg
        └── photo_2.jpg
```

## Troubleshooting

| Problem | Fix |
|---|---|
| App is slow on first request | Render free tier sleeps after 15 min. First request takes 30–60 sec. Upgrade to Render Starter ($7/mo) to eliminate this. |
| Sync helper isn't downloading | Check `sync-helper/sync.log`. Verify `api_base_url` and `sync_api_key` match Render exactly. |
| Photos look compressed | Photos are compressed to ~1 MB on the phone to save mobile data. This is by design. |
| Reset a project PIN | Use the admin page → Change PIN. |
| Admin page won't log in | Check the `ADMIN_PIN` env var on Render (Settings → Environment). |
| "Session expired" on report page | PIN sessions last 12 hours. Just re-enter your PIN. |
