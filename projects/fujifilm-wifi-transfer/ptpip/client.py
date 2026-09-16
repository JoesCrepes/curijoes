#!/usr/bin/env python3
"""Minimal PTP/IP client skeleton.

Only does the INIT_COMMAND_REQUEST/ACK handshake, which is standard PTP/IP
and doesn't depend on whatever discovery mechanism the app uses. Point it at
the camera's IP once you know it (from the capture, or from your phone's
wifi settings while connected to the camera's AP - it'll be the gateway).

This is meant for poking at the camera directly to see if it speaks plain
PTP/IP at all before we've fully mapped what the app does. It intentionally
does not implement OpenSession/GetDeviceInfo yet - add those once the
handshake is confirmed to work.

Usage:
    python -m ptpip.client <camera-ip> [port]
"""

from __future__ import annotations

import socket
import struct
import sys
import uuid

from .container import Container, PacketType, split_containers, type_name

DEFAULT_PORT = 15740
GUID = uuid.uuid4().bytes  # random per run; real clients likely persist this
FRIENDLY_NAME = "curijoes-ptpip-probe"


def build_init_command_request() -> Container:
    name_utf16 = FRIENDLY_NAME.encode("utf-16-le") + b"\x00\x00"
    payload = GUID + name_utf16 + struct.pack("<I", 0x00010000)  # version 1.0
    return Container(type=PacketType.INIT_COMMAND_REQUEST, payload=payload)


def probe(host: str, port: int = DEFAULT_PORT, timeout: float = 5.0) -> None:
    print(f"connecting to {host}:{port} ...")
    with socket.create_connection((host, port), timeout=timeout) as sock:
        req = build_init_command_request()
        sock.sendall(req.to_bytes())
        print(f"-> sent {type_name(req.type)}")

        buf = b""
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                print("connection closed by camera")
                break
            buf += chunk
            containers, buf = split_containers(buf)
            for c in containers:
                print(f"<- {type_name(c.type)} ({len(c.payload)} bytes payload)")
                print(f"   {c.payload[:64].hex()}")
                if c.type == PacketType.INIT_COMMAND_ACK:
                    print("handshake succeeded - camera speaks PTP/IP.")
                    return
                if c.type == PacketType.INIT_FAIL:
                    print("camera rejected the init request.")
                    return


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    host = sys.argv[1]
    port = int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_PORT
    probe(host, port)
