"""PTP/IP container framing.

Every PTP/IP packet on the wire is:
    uint32 length   (total length, including this header)
    uint32 type     (one of PacketType)
    bytes  payload  (length - 8 bytes)

This module only handles that framing layer, not the PTP operation payloads
themselves (those come from the PTP layer carried inside CMD_REQUEST /
CMD_RESPONSE / DATA_PACKET containers).
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from enum import IntEnum


class PacketType(IntEnum):
    INIT_COMMAND_REQUEST = 1
    INIT_COMMAND_ACK = 2
    INIT_EVENT_REQUEST = 3
    INIT_EVENT_ACK = 4
    INIT_FAIL = 5
    CMD_REQUEST = 6
    CMD_RESPONSE = 7
    EVENT = 8
    START_DATA_PACKET = 9
    DATA_PACKET = 10
    CANCEL_TRANSACTION = 11
    END_DATA_PACKET = 12
    PROBE_REQUEST = 13
    PROBE_RESPONSE = 14


def type_name(value: int) -> str:
    try:
        return PacketType(value).name
    except ValueError:
        return f"UNKNOWN(0x{value:02x})"


@dataclass
class Container:
    type: int
    payload: bytes

    def to_bytes(self) -> bytes:
        length = 8 + len(self.payload)
        return struct.pack("<II", length, self.type) + self.payload

    @classmethod
    def from_bytes(cls, data: bytes) -> "Container":
        if len(data) < 8:
            raise ValueError(f"container too short: {len(data)} bytes")
        length, ptype = struct.unpack_from("<II", data, 0)
        payload = data[8:length]
        return cls(type=ptype, payload=payload)


def split_containers(buf: bytes) -> tuple[list[Container], bytes]:
    """Split a byte stream (e.g. reassembled TCP payload) into whole
    containers, returning (containers, leftover_bytes)."""
    containers: list[Container] = []
    offset = 0
    while True:
        if len(buf) - offset < 8:
            break
        (length,) = struct.unpack_from("<I", buf, offset)
        if length < 8 or offset + length > len(buf):
            break
        containers.append(Container.from_bytes(buf[offset : offset + length]))
        offset += length
    return containers, buf[offset:]
