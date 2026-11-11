"""Copy PocketBase snapshots and the app's restore files to Google Drive."""

import argparse
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import logging
from logging.handlers import RotatingFileHandler
import msvcrt
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parent.parent
ARCHIVE_NAME = re.compile(r"pakkelapp-(\d{4}-\d{2}-\d{2})\.zip\Z")
SNAPSHOT_NAME = re.compile(r"@auto_pb_backup_.+_(\d{14})\.zip\Z")


def run(*args):
    return subprocess.run(args, cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def validate_zip(path):
    with zipfile.ZipFile(path) as archive:
        damaged = archive.testzip()
        if damaged:
            raise RuntimeError(f"Damaged ZIP entry in {path.name}: {damaged}")


def expired_archives(folder, today):
    """Keep seven calendar days and the newest older archive per ISO week."""
    archives = []
    for path in folder.iterdir():
        match = ARCHIVE_NAME.fullmatch(path.name)
        if path.is_file() and match:
            archives.append((date.fromisoformat(match[1]), path))
    cutoff = today - timedelta(days=6)
    kept_weeks = set()
    expired = []
    for day, path in sorted(archives, reverse=True):
        if day >= cutoff:
            continue
        week = day.isocalendar()[:2]
        if week in kept_weeks:
            expired.append(path)
        else:
            kept_weeks.add(week)
    return expired


def backup(destination, cache, docker, git):
    if not destination.is_dir():
        raise RuntimeError(f"Google Drive folder is unavailable: {destination}")
    names = run(docker, "exec", "pakkelapp", "ls", "-1", "/data/backups").splitlines()
    snapshots = []
    for name in names:
        match = SNAPSHOT_NAME.fullmatch(name)
        if match:
            moment = datetime.strptime(match[1], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
            snapshots.append((moment, name))
    if not snapshots:
        raise RuntimeError("No automatic PocketBase backup is available")
    moment, name = max(snapshots)
    age = datetime.now(timezone.utc) - moment
    if age > timedelta(hours=36) or age < -timedelta(minutes=5):
        raise RuntimeError(f"PocketBase backup timestamp is unexpected: {moment.isoformat()}")
    day = moment.astimezone().date()
    archive_name = f"pakkelapp-{day.isoformat()}.zip"
    local = cache / archive_name
    if not local.exists():
        with tempfile.TemporaryDirectory(prefix="build-", dir=cache) as scratch:
            work = Path(scratch)
            snapshot = work / "pocketbase.zip"
            run(docker, "cp", f"pakkelapp:/data/backups/{name}", str(snapshot))
            validate_zip(snapshot)
            with zipfile.ZipFile(snapshot) as data:
                if "data.db" not in data.namelist():
                    raise RuntimeError("Snapshot does not contain the app database")
            source = work / "app-source.zip"
            run(git, "archive", "--format=zip", f"--output={source}", "HEAD")
            manifest = {
                "created_at": datetime.now(timezone.utc).isoformat(),
                "database_backup_at": moment.isoformat(),
                "database_backup_file": name,
                "source_revision": run(git, "rev-parse", "HEAD"),
                "database_sha256": digest(snapshot),
                "source_sha256": digest(source),
                "retention": "7 calendar days, then newest archive per ISO week, indefinitely",
            }
            bundle = work / archive_name
            with zipfile.ZipFile(bundle, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.write(snapshot, "pocketbase.zip")
                archive.write(source, "app-source.zip")
                archive.write(ROOT / ".env", "app.env")
                archive.writestr("manifest.json", json.dumps(manifest, indent=2))
                archive.writestr("RESTORE.txt", (
                    "Pakkelapp restore\n\n"
                    "1. Stop Pakkelapp before restoring. Keep a copy of the current data volume.\n"
                    "2. Extract app-source.zip to the app folder and copy app.env to .env.\n"
                    "3. Extract pocketbase.zip into an empty data volume named JUL_DATA_VOLUME\n"
                    "   from .env (default pakkelapp-data). Preserve storage/, invite.txt and vapid.json.\n"
                    "4. Set data ownership to UID/GID 10001:10001.\n"
                    "5. Run docker compose up -d --build from the restored app folder.\n"
                    "6. Check /api/health, sign-in and an uploaded image before resuming use.\n\n"
                    "manifest.json identifies the database time and the packaged source revision.\n"
                    "app.env contains the deployment configuration and API credentials.\n"
                ))
            validate_zip(bundle)
            bundle.replace(local)
    validate_zip(local)
    remote = destination / archive_name
    if not remote.exists() or digest(remote) != digest(local):
        pending = destination / (archive_name + ".uploading")
        shutil.copyfile(local, pending)
        if digest(pending) != digest(local):
            raise RuntimeError("Google Drive copy checksum mismatch")
        pending.replace(remote)
    if digest(remote) != digest(local):
        raise RuntimeError("Final Google Drive copy checksum mismatch")
    logging.info("Drive copy verified: %s (%d bytes). Database UTC: %s", remote.name, remote.stat().st_size, moment.isoformat())
    # Prune only our date-named archives after the current copy has been verified.
    for folder in (destination, cache):
        for expired in expired_archives(folder, date.today()):
            expired.unlink()
            logging.info("Retention removed %s", expired)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, default=Path("G:/My Drive/Pakkelapp – backup"))
    parser.add_argument("--docker", default="C:/Program Files/Docker/Docker/resources/bin/docker.exe")
    parser.add_argument("--git", default="C:/Program Files/Git/cmd/git.exe")
    args = parser.parse_args()
    cache = ROOT / "backups" / "google-drive"
    cache.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(cache / "backup.log", maxBytes=1_000_000, backupCount=2, encoding="utf-8")
    handlers = [handler]
    if sys.stderr is not None:
        handlers.append(logging.StreamHandler())
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", handlers=handlers)
    with (cache / "backup.lock").open("a+b") as lock:
        if lock.tell() == 0:
            lock.write(b"0")
            lock.flush()
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            logging.info("Another backup is running")
            return
        try:
            backup(args.destination, cache, args.docker, args.git)
        except Exception:
            logging.exception("Backup failed. Retention did not complete.")
            raise
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


if __name__ == "__main__":
    main()
