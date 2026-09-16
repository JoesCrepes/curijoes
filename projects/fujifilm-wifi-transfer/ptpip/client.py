#!/usr/bin/env python3
"""Minimal PTP/IP client skeleton, using Fuji's actual init packet layout.

Does the INIT_COMMAND_REQUEST/ACK handshake and nothing else. Point it at
the camera's IP once you know it (from your laptop's wifi connection details
while associated to the camera's AP - it'll be the gateway, typically
192.168.0.1). Requires the camera's own screen to have "WIRELESS
COMMUNICATION" (or "WIRELESS TRANSFER") actively selected as the current
function - per petabyt/libfuji's FujiTransport enum, that's the specific
camera-menu mode this port/handshake belongs to (as opposed to PC AutoSave
or Wireless Tether, which are separate modes/protocols entirely). A bare
wifi association is not enough on its own.

This intentionally does not implement OpenSession or anything past the
handshake yet - the next steps per petabyt/fudge-legacy-android's fuji.c are
ptp_open_session(), then polling fuji_get_events() until the camera's state
leaves FUJI_WAIT_FOR_ACCESS (0), then a strict-order property negotiation,
before any GetObjectHandles/GetObject calls will work. Add those once this
basic handshake is confirmed to succeed.

Usage:
    python -m ptpip.client <camera-ip> [port]
"""

from __future__ import annotations

import socket
import struct
import sys
import uuid

from .container import Container, PacketType, split_containers, type_name

# Fuji deviates from the generic PTP/IP default (15740): confirmed via
# petabyt/libfuji (lib/fujiptp.h), which has three separate ports:
#   55740 - command/data (this is the one we want for INIT_COMMAND_REQUEST)
#   55741 - event
#   55742 - streamer/live view
DEFAULT_PORT = 55740
GUID = uuid.uuid4().bytes  # random per run; real clients likely persist this
FRIENDLY_NAME = "curijoes-ptpip-probe"

# Fuji's INIT_COMMAND_REQUEST payload is NOT the generic PTP/IP layout
# (GUID + variable-length name + version). Per petabyt/libfuji's
# `struct FujiInitPacket` in lib/fujiptp.h (verified against the actual
# source, not a paraphrase):
#   uint32 length; uint32 type; uint32 version; uint32 guid[4];
#   char device_name[54];  // fixed size, not null-terminated-variable
# length+type are our Container header (built by container.py); the rest is
# this payload. version is a fixed magic constant, not a real version number.
FUJI_PROTOCOL_VERSION = 0x8F53E4F2
DEVICE_NAME_FIELD_SIZE = 54


def build_init_command_request() -> Container:
    guid1, guid2, guid3, guid4 = struct.unpack("<4I", GUID)
    name_bytes = FRIENDLY_NAME.encode("utf-16-le")
    name_bytes = name_bytes[:DEVICE_NAME_FIELD_SIZE].ljust(DEVICE_NAME_FIELD_SIZE, b"\x00")
    payload = struct.pack(
        f"<5I{DEVICE_NAME_FIELD_SIZE}s",
        FUJI_PROTOCOL_VERSION,
        guid1,
        guid2,
        guid3,
        guid4,
        name_bytes,
    )
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
