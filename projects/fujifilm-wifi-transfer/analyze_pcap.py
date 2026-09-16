#!/usr/bin/env python3
"""Decode a capture of the Fujifilm app <-> X-T10 session.

Prints:
  - a summary of every distinct (proto, src, dst, port) conversation, so you
    can see at a glance what talked to what before digging in
  - for any TCP conversation involving port 15740 (or one you point it at
    with --port), decoded PTP/IP containers reassembled from the TCP stream
  - for UDP traffic, a hexdump of each datagram, since discovery/pairing is
    likely UDP and not yet framed as anything we know how to parse

Usage:
    python analyze_pcap.py capture.pcapng
    python analyze_pcap.py capture.pcapng --port 15740
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict

from scapy.all import rdpcap
from scapy.layers.inet import IP, TCP, UDP

from ptpip.container import split_containers, type_name


def summarize(packets) -> None:
    conversations: dict[tuple, int] = defaultdict(int)
    for pkt in packets:
        if IP not in pkt:
            continue
        ip = pkt[IP]
        if TCP in pkt:
            key = ("TCP", ip.src, ip.dst, pkt[TCP].sport, pkt[TCP].dport)
        elif UDP in pkt:
            key = ("UDP", ip.src, ip.dst, pkt[UDP].sport, pkt[UDP].dport)
        else:
            continue
        conversations[key] += 1

    print(f"{len(packets)} packets, {len(conversations)} conversations:\n")
    for (proto, src, dst, sport, dport), count in sorted(
        conversations.items(), key=lambda kv: -kv[1]
    ):
        print(f"  {proto:3} {src}:{sport:<5} -> {dst}:{dport:<5}  {count} packets")
    print()


def decode_tcp_port(packets, port: int) -> None:
    streams: dict[tuple, bytes] = defaultdict(bytes)
    for pkt in packets:
        if IP not in pkt or TCP not in pkt:
            continue
        tcp = pkt[TCP]
        if port not in (tcp.sport, tcp.dport):
            continue
        if not bytes(tcp.payload):
            continue
        key = (pkt[IP].src, tcp.sport, pkt[IP].dst, tcp.dport)
        streams[key] += bytes(tcp.payload)

    if not streams:
        print(f"no TCP traffic seen on port {port}")
        return

    for (src, sport, dst, dport), data in streams.items():
        print(f"--- TCP {src}:{sport} -> {dst}:{dport} ({len(data)} bytes) ---")
        containers, leftover = split_containers(data)
        for c in containers:
            print(f"  {type_name(c.type):22} payload={len(c.payload):>6}B  {c.payload[:32].hex()}")
        if leftover:
            print(f"  ({len(leftover)} trailing bytes not forming a whole container)")
        print()


def decode_udp(packets) -> None:
    seen = False
    for pkt in packets:
        if IP not in pkt or UDP not in pkt:
            continue
        payload = bytes(pkt[UDP].payload)
        if not payload:
            continue
        seen = True
        print(
            f"UDP {pkt[IP].src}:{pkt[UDP].sport} -> {pkt[IP].dst}:{pkt[UDP].dport} "
            f"({len(payload)}B): {payload[:64].hex()}"
        )
    if not seen:
        print("no UDP payloads seen")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pcap", help="path to .pcap/.pcapng file")
    parser.add_argument(
        "--port", type=int, default=15740, help="TCP port to decode as PTP/IP (default 15740)"
    )
    args = parser.parse_args()

    try:
        packets = rdpcap(args.pcap)
    except FileNotFoundError:
        print(f"file not found: {args.pcap}", file=sys.stderr)
        sys.exit(1)

    print("=== conversation summary ===\n")
    summarize(packets)

    print(f"=== TCP port {args.port} decoded as PTP/IP ===\n")
    decode_tcp_port(packets, args.port)

    print("=== UDP payloads (discovery/pairing candidates) ===\n")
    decode_udp(packets)


if __name__ == "__main__":
    main()
