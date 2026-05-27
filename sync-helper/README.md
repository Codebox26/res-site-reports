# RES Sync Helper

Runs on each team member's laptop. Polls the RES API every 60 seconds and downloads new site reports to your OneDrive folder.

## Quick Start

1. Copy `config.example.json` → `config.json`
2. Fill in `config.json` (see below)
3. Right-click `install-windows.bat` → **Run as administrator**

## config.json fields

| Field | Value |
|---|---|
| `api_base_url` | Your Render app URL e.g. `https://res-reports.onrender.com` |
| `sync_api_key` | The `SYNC_API_KEY` from your Render env vars |
| `onedrive_base_path` | Full path to your OneDrive reports folder |
| `laptop_id` | A unique name for this laptop (e.g. `benedict-laptop`) |
| `poll_interval_seconds` | How often to check (default `60`) |

## What it creates

```
{onedrive_base_path}/
└── {Project Name}/
    └── {YYYY-MM-DD}/
        ├── RES_Daily_Site_Report_ProjectName_DD-MM-YYYY.docx
        ├── photo_1.jpg
        └── photo_2.jpg
```

## Troubleshooting

- **Nothing is downloading**: Check `sync.log` for errors. Verify `api_base_url` and `sync_api_key` match Render exactly.
- **Task Scheduler error**: Right-click the .bat file → "Run as administrator".
- **Run manually**: `python res_sync.py`
