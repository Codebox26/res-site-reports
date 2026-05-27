"""
RES Sync Helper
Polls the RES Daily Site Reports API and downloads new submissions to a local OneDrive folder.
Run once manually or use install-windows.bat to set up auto-start at login.
"""

import os
import json
import time
import socket
import logging
import requests
from pathlib import Path
from datetime import datetime

CONFIG_PATH = Path(__file__).parent / "config.json"
LOG_PATH    = Path(__file__).parent / "sync.log"
STATE_PATH  = Path(__file__).parent / ".sync_state.json"

logging.basicConfig(
    filename=LOG_PATH,
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
# Also log to console so users can see activity if running manually
console = logging.StreamHandler()
console.setLevel(logging.INFO)
console.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s', '%H:%M:%S'))
logging.getLogger().addHandler(console)

log = logging.getLogger()


def load_config():
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(
            f"\nConfig file not found at:\n  {CONFIG_PATH}\n\n"
            "Copy config.example.json to config.json and fill in your values."
        )
    return json.loads(CONFIG_PATH.read_text(encoding='utf-8'))


def load_state():
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text(encoding='utf-8'))
        except Exception:
            pass
    return {"last_sync": "1970-01-01T00:00:00Z"}


def save_state(state):
    STATE_PATH.write_text(json.dumps(state, indent=2), encoding='utf-8')


def ensure_folder(path: Path):
    path.mkdir(parents=True, exist_ok=True)


def download_file(url: str, dest_path: Path, timeout: int = 60):
    """Download a file from url to dest_path with streaming."""
    r = requests.get(url, stream=True, timeout=timeout)
    r.raise_for_status()
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    with open(dest_path, 'wb') as f:
        for chunk in r.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)


def sync_once(config: dict, laptop_id: str, state: dict):
    api_url     = config["api_base_url"].rstrip('/')
    api_key     = config["sync_api_key"]
    base_output = Path(config["onedrive_base_path"])

    ensure_folder(base_output)

    headers = {"x-api-key": api_key}
    params  = {"laptopId": laptop_id, "since": state["last_sync"]}

    try:
        resp = requests.get(
            f"{api_url}/api/sync/pending",
            headers=headers,
            params=params,
            timeout=30
        )
        resp.raise_for_status()
        pending = resp.json()
    except requests.exceptions.ConnectionError:
        log.warning("No internet connection — will retry next cycle.")
        return
    except requests.exceptions.HTTPError as e:
        log.error(f"API error: {e.response.status_code} {e.response.text[:200]}")
        return

    if not pending:
        log.info("No new submissions.")
        return

    log.info(f"Found {len(pending)} new submission(s).")

    for sub in pending:
        submission_id = sub.get("submissionId", "unknown")
        try:
            project_name = sub["projectName"]
            report_date  = sub["reportDate"]   # YYYY-MM-DD
            docx_url     = sub.get("docxUrl")
            docx_filename = sub.get("docxFilename", f"report_{report_date}.docx")
            photo_urls   = sub.get("photoUrls", [])

            # Folder: {OneDrive base}/{Project Name}/{YYYY-MM-DD}/
            folder = base_output / project_name / report_date
            ensure_folder(folder)

            # Download DOCX
            if docx_url:
                docx_dest = folder / docx_filename
                download_file(docx_url, docx_dest)
                log.info(f"  ✓ DOCX:  {docx_dest}")

            # Download photos
            for i, photo_url in enumerate(photo_urls, 1):
                # Preserve extension from URL (strip query strings)
                raw_ext = photo_url.split('?')[0].rsplit('.', 1)
                ext = raw_ext[-1].lower() if len(raw_ext) > 1 else 'jpg'
                if ext not in ('jpg', 'jpeg', 'png', 'heic', 'webp'):
                    ext = 'jpg'
                photo_dest = folder / f"photo_{i}.{ext}"
                download_file(photo_url, photo_dest)
                log.info(f"  ✓ Photo: {photo_dest}")

            # Acknowledge success
            requests.post(
                f"{api_url}/api/sync/acknowledge",
                headers=headers,
                json={"submissionId": submission_id, "laptopId": laptop_id, "status": "success"},
                timeout=30
            )

        except Exception as e:
            log.error(f"  ✗ Failed to sync {submission_id}: {e}")
            # Acknowledge as error so we log it server-side
            try:
                requests.post(
                    f"{api_url}/api/sync/acknowledge",
                    headers=headers,
                    json={"submissionId": submission_id, "laptopId": laptop_id, "status": f"error: {e}"},
                    timeout=30
                )
            except Exception:
                pass

    state["last_sync"] = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    save_state(state)


def main():
    print("=" * 60)
    print("  RES Sync Helper")
    print("  Polls for new site reports and saves to your OneDrive")
    print("=" * 60)

    try:
        config = load_config()
    except FileNotFoundError as e:
        log.error(str(e))
        return

    laptop_id     = config.get("laptop_id") or socket.gethostname()
    poll_interval = int(config.get("poll_interval_seconds", 60))
    state         = load_state()

    log.info(f"Laptop ID: {laptop_id} | Polling every {poll_interval}s")
    log.info(f"Output folder: {config['onedrive_base_path']}")

    while True:
        try:
            sync_once(config, laptop_id, state)
        except Exception as e:
            log.error(f"Unexpected sync error: {e}")
        time.sleep(poll_interval)


if __name__ == "__main__":
    main()
