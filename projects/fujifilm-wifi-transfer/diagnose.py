#!/usr/bin/env python3
"""Network-layer diagnostics for the camera's wifi AP, no packet capture
needed. Run this from a laptop that has joined the camera's wifi network
(most camera APs tolerate a second simultaneous client alongside the
phone; if yours doesn't, disconnect the phone first).

Checks, in order:
  1. Can we reach the camera at all (TCP connect to a handful of common
     ports)?
  2. Does TCP 15740 (standard PTP/IP) respond, and if so does a PTP/IP
     INIT_COMMAND_REQUEST handshake succeed?

This tells you whether the camera is reachable and speaking PTP/IP at the
network level, independent of whatever the Android app is or isn't doing -
useful for isolating "app problem" vs. "camera/network problem" without
needing to decode any traffic.

Usage:
    python diagnose.py <camera-ip>
"""

from __future__ import annotations

import socket
import sys

from ptpip.client import DEFAULT_PORT, probe

COMMON_PORTS = {
    55740: "Fuji PTP/IP command/data (confirmed via malc0mn/ptp-ip)",
    55741: "Fuji PTP/IP event connection",
    55742: "Fuji PTP/IP streamer/live view connection",
    15740: "PTP/IP (generic default - Fuji doesn't use this)",
    80: "HTTP (possible config/status page)",
    8080: "HTTP alt",
    5353: "mDNS (possible discovery)",
    443: "HTTPS",
}


def check_port(host: str, port: int, timeout: float = 3.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    host = sys.argv[1]

    print(f"=== port scan against {host} ===\n")
    any_open = False
    for port, desc in COMMON_PORTS.items():
        open_ = check_port(host, port)
        any_open = any_open or open_
        status = "OPEN" if open_ else "closed/filtered"
        print(f"  {port:<6} {status:<16} {desc}")
    print()

    if not any_open:
        print(
            "No ports responded at all. This means either:\n"
            "  - the IP is wrong (double check camera's IP from your phone's\n"
            "    wifi connection details while associated), or\n"
            "  - you're not actually on the same network as the camera, or\n"
            "  - the camera isn't in a wireless-communication mode that\n"
            "    exposes any services yet.\n"
            "This is a connectivity problem, not a protocol problem - the\n"
            "app can't do anything either in this state."
        )
        return

    if check_port(host, DEFAULT_PORT):
        print(f"=== attempting PTP/IP handshake on port {DEFAULT_PORT} ===\n")
        probe(host, DEFAULT_PORT)
    else:
        print(
            f"Port {DEFAULT_PORT} (Fuji PTP/IP command/data) is not open, but other "
            "ports are. This camera/mode may use a different protocol or "
            "port than assumed - worth checking whatever port IS open "
            "manually (e.g. `curl http://<ip>` if 80 is open)."
        )


if __name__ == "__main__":
    main()
