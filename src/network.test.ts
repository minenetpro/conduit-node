import { expect, test } from "bun:test";
import { parseIpv4Addresses, parsePrimaryInterface } from "./network";

test("parsePrimaryInterface reads the default route device", () => {
  const iface = parsePrimaryInterface(
    "default via 192.0.2.1 dev enp1s0 proto dhcp src 192.0.2.10 metric 100",
  );

  expect(iface).toBe("enp1s0");
});

test("parseIpv4Addresses collects all IPv4 interface addresses", () => {
  const addresses = parseIpv4Addresses([
    "2: enp1s0    inet 192.0.2.10/24 brd 192.0.2.255 scope global dynamic enp1s0",
    "2: enp1s0    inet 216.128.135.193/32 scope global secondary enp1s0",
  ].join("\n"));

  expect(Array.from(addresses).sort()).toEqual([
    "192.0.2.10",
    "216.128.135.193",
  ]);
});
