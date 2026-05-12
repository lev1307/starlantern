#!/usr/bin/env python3
"""
shutdown_when_idle.py — turn the laptop off once Claude Code stops writing
heartbeats to _brain/journal/_session_ticks.log.

Background
----------
The repo's .claude/settings.json has a Stop-hook that appends a timestamp to
_brain/journal/_session_ticks.log after every assistant turn. While Claude is
working, that file ticks every few seconds-to-minutes. When Claude stops
responding (session closed, model out of tokens, you walked away), the file
goes silent.

This watcher polls the file's mtime; when it has been silent for at least
--idle-minutes, it triggers `shutdown /s /f /t <shutdown-delay-seconds>`. The
delay gives you one last chance to abort with `shutdown /a` (run from a
PowerShell window) if you want to keep working.

Usage
-----
    # Default: idle 15 min, shutdown 60 s grace, on Windows
    py scripts\\shutdown_when_idle.py

    # Try first without actually shutting down (recommended for verification)
    py scripts\\shutdown_when_idle.py --dry-run --idle-minutes 1

    # Less patient, bigger grace
    py scripts\\shutdown_when_idle.py --idle-minutes 10 --shutdown-delay-seconds 180

    # Different heartbeat file
    py scripts\\shutdown_when_idle.py --watch path\\to\\some\\file

Cancel a queued shutdown (you have <shutdown-delay-seconds> to do this):
    shutdown /a
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

DEFAULT_WATCH = Path("_brain/journal/_session_ticks.log")
DEFAULT_IDLE_MIN = 15.0
DEFAULT_GRACE_S = 60
POLL_S = 15.0


def _trigger_shutdown(grace_s: int, dry_run: bool) -> None:
    cmd = ["shutdown", "/s", "/f", "/t", str(grace_s)]
    print(f"[shutdown-watcher] firing: {' '.join(cmd)}")
    print(
        f"[shutdown-watcher] To cancel within the next {grace_s} s, "
        "open a terminal and run:  shutdown /a"
    )
    if dry_run:
        print("[shutdown-watcher] --dry-run set: not actually shutting down.")
        return
    if sys.platform != "win32":
        print(
            f"[shutdown-watcher] ERROR: this script targets Windows. "
            f"sys.platform={sys.platform!r}. Aborting."
        )
        sys.exit(2)
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        print(f"[shutdown-watcher] shutdown command failed: {e}")
        sys.exit(e.returncode)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--watch",
        type=Path,
        default=DEFAULT_WATCH,
        help=f"Heartbeat file to watch (default: {DEFAULT_WATCH}).",
    )
    parser.add_argument(
        "--idle-minutes",
        type=float,
        default=DEFAULT_IDLE_MIN,
        help=f"Minutes of file silence before shutdown is triggered (default: {DEFAULT_IDLE_MIN}).",
    )
    parser.add_argument(
        "--shutdown-delay-seconds",
        type=int,
        default=DEFAULT_GRACE_S,
        help=(
            "Grace period passed to `shutdown /t`. Gives you time to run "
            f"`shutdown /a` to cancel. Default: {DEFAULT_GRACE_S}."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would happen but never call `shutdown`.",
    )
    parser.add_argument(
        "--poll-seconds",
        type=float,
        default=POLL_S,
        help=f"How often to re-check the heartbeat file (default: {POLL_S}).",
    )
    args = parser.parse_args()

    idle_seconds = args.idle_minutes * 60
    watch: Path = args.watch.resolve()

    print(
        f"[shutdown-watcher] watching {watch}\n"
        f"                   idle threshold: {args.idle_minutes:.1f} min\n"
        f"                   grace: {args.shutdown_delay_seconds} s\n"
        f"                   poll: {args.poll_seconds:.0f} s\n"
        f"                   dry-run: {args.dry_run}\n"
    )

    # Wait politely for the file to appear if it doesn't yet.
    waited = 0
    while not watch.exists():
        if waited == 0:
            print(f"[shutdown-watcher] {watch} does not exist yet — waiting for first tick…")
        time.sleep(args.poll_seconds)
        waited += args.poll_seconds
        if waited > 30 * 60:
            print("[shutdown-watcher] No heartbeat after 30 min. Exiting.")
            sys.exit(1)

    last_seen_mtime: float | None = None
    silent_since: float | None = None

    while True:
        try:
            mtime = watch.stat().st_mtime
        except FileNotFoundError:
            time.sleep(args.poll_seconds)
            continue

        now = time.time()
        if last_seen_mtime is None or mtime > last_seen_mtime:
            # Fresh heartbeat.
            last_seen_mtime = mtime
            silent_since = None
            print(
                f"[shutdown-watcher] heartbeat at {time.strftime('%H:%M:%S', time.localtime(mtime))}",
                flush=True,
            )
        else:
            silent_since = silent_since or mtime
            silent_for = now - silent_since
            remaining = idle_seconds - silent_for
            print(
                f"[shutdown-watcher] silent for {silent_for/60:.1f} min; "
                f"{remaining/60:.1f} min until shutdown.",
                flush=True,
            )
            if silent_for >= idle_seconds:
                _trigger_shutdown(args.shutdown_delay_seconds, args.dry_run)
                return

        time.sleep(args.poll_seconds)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[shutdown-watcher] interrupted, exiting cleanly.")
