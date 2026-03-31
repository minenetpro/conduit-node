import path from "node:path";
import { readFile } from "node:fs/promises";
import type { AgentConfig } from "./config";
import { listManagedFrpsContainers, runCommand } from "./docker";
import { loadReservedIpState, saveReservedIpState, upsertReservedIpLease } from "./state";

const RESERVED_IP_PREFIX = 32;

export const parsePrimaryInterface = (routeOutput: string) => {
  for (const line of routeOutput.split("\n")) {
    const match = /\bdev\s+(\S+)/.exec(line);
    if (match) {
      return match[1];
    }
  }

  return null;
};

export const parseIpv4Addresses = (addressOutput: string) => {
  const addresses = new Set<string>();

  for (const line of addressOutput.split("\n")) {
    const match = /\binet\s+([0-9.]+)\//.exec(line);
    if (match) {
      addresses.add(match[1]);
    }
  }

  return addresses;
};

const parseIpv4AddressInterfaces = (addressOutput: string) => {
  const addresses = new Map<string, string>();

  for (const line of addressOutput.split("\n")) {
    const match = /^\d+:\s+(\S+)\s+inet\s+([0-9.]+)\//.exec(line.trim());
    if (match) {
      addresses.set(match[2], match[1]);
    }
  }

  return addresses;
};

const parseBindAddress = (configContents: string) => {
  const match = /^\s*bindAddr\s*=\s*"([^"]+)"/m.exec(configContents);
  return match?.[1] ?? null;
};

export const detectPrimaryInterface = async () => {
  const routeResult = await runCommand(["ip", "-4", "route", "show", "default"], true);
  const fromDefaultRoute = parsePrimaryInterface(routeResult.stdout);
  if (fromDefaultRoute) {
    return fromDefaultRoute;
  }

  const routeGetResult = await runCommand(
    ["ip", "-4", "route", "get", "1.1.1.1"],
    true,
  );
  const fromRouteLookup = parsePrimaryInterface(routeGetResult.stdout);
  if (fromRouteLookup) {
    return fromRouteLookup;
  }

  throw new Error("Unable to determine the primary network interface.");
};

const listInterfaceAddresses = async (iface: string) => {
  const result = await runCommand(
    ["ip", "-4", "-o", "addr", "show", "dev", iface],
    true,
  );

  if (result.exitCode !== 0) {
    throw new Error(
      `Unable to inspect IPv4 addresses on ${iface}: ${result.stderr || result.stdout}`,
    );
  }

  return parseIpv4Addresses(result.stdout);
};

const listAddressInterfaces = async () => {
  const result = await runCommand(["ip", "-4", "-o", "addr", "show"], true);

  if (result.exitCode !== 0) {
    throw new Error(
      `Unable to inspect host IPv4 addresses: ${result.stderr || result.stdout}`,
    );
  }

  return parseIpv4AddressInterfaces(result.stdout);
};

export const ensureReservedIpOnHost = async (address: string) => {
  const iface = await detectPrimaryInterface();
  const addressInterfaces = await listAddressInterfaces();
  const existingInterface = addressInterfaces.get(address);
  let added = false;

  if (existingInterface && existingInterface !== iface) {
    throw new Error(
      `Reserved IP ${address} is already configured on ${existingInterface}, expected ${iface}.`,
    );
  }

  if (!existingInterface) {
    await runCommand([
      "ip",
      "addr",
      "add",
      `${address}/${RESERVED_IP_PREFIX}`,
      "dev",
      iface,
    ]);
    added = true;
  }

  const confirmedAddresses = await listInterfaceAddresses(iface);
  if (!confirmedAddresses.has(address)) {
    throw new Error(`Reserved IP ${address} did not appear on ${iface}.`);
  }

  return {
    iface,
    added,
  };
};

export const removeReservedIpFromHost = async (address: string) => {
  const addressInterfaces = await listAddressInterfaces();
  const iface = addressInterfaces.get(address);

  if (!iface) {
    return false;
  }

  await runCommand(
    [
      "ip",
      "addr",
      "del",
      `${address}/${RESERVED_IP_PREFIX}`,
      "dev",
      iface,
    ],
    true,
  );

  const confirmedAddresses = await listInterfaceAddresses(iface);
  if (confirmedAddresses.has(address)) {
    throw new Error(`Reserved IP ${address} is still configured on ${iface}.`);
  }

  return true;
};

export const syncReservedIps = async (config: AgentConfig) => {
  const state = await loadReservedIpState(config);
  const staleLeases = state.leases.filter((lease) => lease.status !== "active");
  const activeLeases = state.leases.filter((lease) => lease.status === "active");

  for (const lease of staleLeases) {
    await removeReservedIpFromHost(lease.address);
  }

  if (staleLeases.length > 0) {
    await saveReservedIpState(config, {
      version: 1,
      leases: activeLeases,
    });
  }

  if (activeLeases.length === 0) {
    return [];
  }

  const iface = await detectPrimaryInterface();
  const addressInterfaces = await listAddressInterfaces();

  for (const lease of activeLeases) {
    const existingInterface = addressInterfaces.get(lease.address);
    if (existingInterface && existingInterface !== iface) {
      throw new Error(
        `Reserved IP ${lease.address} is configured on ${existingInterface}, expected ${iface}.`,
      );
    }

    if (!existingInterface) {
      await runCommand([
        "ip",
        "addr",
        "add",
        `${lease.address}/${RESERVED_IP_PREFIX}`,
        "dev",
        iface,
      ]);
    }
  }

  const confirmedAddresses = await listInterfaceAddresses(iface);
  for (const lease of activeLeases) {
    if (!confirmedAddresses.has(lease.address)) {
      throw new Error(
        `Reserved IP ${lease.address} could not be restored on ${iface}.`,
      );
    }
  }

  return activeLeases.map((lease) => lease.address);
};

export const seedReservedIpsFromRunningFrps = async (config: AgentConfig) => {
  const runningContainers = await listManagedFrpsContainers();
  if (runningContainers.length === 0) {
    return 0;
  }

  const state = await loadReservedIpState(config);
  const knownFrpsIds = new Set(state.leases.map((lease) => lease.frpsId));
  let seeded = 0;

  for (const container of runningContainers) {
    if (knownFrpsIds.has(container.frpsId)) {
      continue;
    }

    const configPath = path.join(config.frpsConfigDir, `${container.frpsId}.toml`);
    let configContents: string;
    try {
      configContents = await readFile(configPath, "utf8");
    } catch {
      continue;
    }

    const address = parseBindAddress(configContents);
    if (!address) {
      continue;
    }

    await upsertReservedIpLease(config, {
      frpsId: container.frpsId,
      address,
      status: "active",
    });
    knownFrpsIds.add(container.frpsId);
    seeded += 1;
  }

  return seeded;
};
