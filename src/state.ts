import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { NodeState, ReservedIpLease, ReservedIpLeaseStatus, ReservedIpState } from "./types";
import type { AgentConfig } from "./config";

export const ensureStateDirs = async (config: AgentConfig) => {
  await mkdir(config.stateDir, { recursive: true });
  await mkdir(config.frpsConfigDir, { recursive: true });
};

const writeJsonAtomic = async (filePath: string, value: unknown) => {
  const tempPath = path.join(
    path.dirname(filePath),
    `${path.basename(filePath)}.${process.pid}.${Date.now().toString(36)}.tmp`,
  );

  await writeFile(tempPath, JSON.stringify(value, null, 2));
  await rename(tempPath, filePath);
};

export const loadNodeState = async (
  config: AgentConfig,
): Promise<NodeState | null> => {
  try {
    const raw = await readFile(config.stateFile, "utf8");
    return JSON.parse(raw) as NodeState;
  } catch {
    return null;
  }
};

export const saveNodeState = async (
  config: AgentConfig,
  state: NodeState,
) => {
  await writeJsonAtomic(config.stateFile, state);
};

const emptyReservedIpState = (): ReservedIpState => ({
  version: 1,
  leases: [],
});

const isLeaseStatus = (value: unknown): value is ReservedIpLeaseStatus =>
  value === "pending" || value === "active" || value === "deleting";

const assertReservedIpState = (value: unknown): ReservedIpState => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("leases" in value) ||
    !Array.isArray(value.leases)
  ) {
    throw new Error("Reserved IP state file is invalid.");
  }

  const seenFrpsIds = new Set<string>();
  const seenAddresses = new Set<string>();
  const leases: ReservedIpLease[] = [];

  for (const lease of value.leases) {
    if (
      typeof lease !== "object" ||
      lease === null ||
      !("frpsId" in lease) ||
      typeof lease.frpsId !== "string" ||
      !("address" in lease) ||
      typeof lease.address !== "string" ||
      !("status" in lease) ||
      !isLeaseStatus(lease.status) ||
      !("updatedAt" in lease) ||
      typeof lease.updatedAt !== "number"
    ) {
      throw new Error("Reserved IP state file contains an invalid lease.");
    }

    if (seenFrpsIds.has(lease.frpsId)) {
      throw new Error(`Reserved IP state has duplicate FRPS lease ${lease.frpsId}.`);
    }

    if (seenAddresses.has(lease.address)) {
      throw new Error(`Reserved IP state has duplicate address ${lease.address}.`);
    }

    seenFrpsIds.add(lease.frpsId);
    seenAddresses.add(lease.address);
    leases.push({
      frpsId: lease.frpsId,
      address: lease.address,
      status: lease.status,
      updatedAt: lease.updatedAt,
    });
  }

  return {
    version: 1,
    leases,
  };
};

export const loadReservedIpState = async (
  config: AgentConfig,
): Promise<ReservedIpState> => {
  try {
    const raw = await readFile(config.reservedIpStateFile, "utf8");
    return assertReservedIpState(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyReservedIpState();
    }

    throw error;
  }
};

export const saveReservedIpState = async (
  config: AgentConfig,
  state: ReservedIpState,
) => {
  const sortedState = {
    version: 1 as const,
    leases: [...state.leases].sort((left, right) =>
      left.frpsId.localeCompare(right.frpsId),
    ),
  };

  await writeJsonAtomic(config.reservedIpStateFile, sortedState);
};

export const getReservedIpLease = async (
  config: AgentConfig,
  frpsId: string,
) => {
  const state = await loadReservedIpState(config);
  return state.leases.find((lease) => lease.frpsId === frpsId) ?? null;
};

export const upsertReservedIpLease = async (
  config: AgentConfig,
  input: {
    frpsId: string;
    address: string;
    status: ReservedIpLeaseStatus;
  },
) => {
  const state = await loadReservedIpState(config);
  const conflictingLease = state.leases.find(
    (lease) => lease.address === input.address && lease.frpsId !== input.frpsId,
  );

  if (conflictingLease) {
    throw new Error(
      `Reserved IP ${input.address} is already assigned to FRPS ${conflictingLease.frpsId}.`,
    );
  }

  const lease: ReservedIpLease = {
    frpsId: input.frpsId,
    address: input.address,
    status: input.status,
    updatedAt: Date.now(),
  };

  await saveReservedIpState(config, {
    version: 1,
    leases: [
      ...state.leases.filter((existing) => existing.frpsId !== input.frpsId),
      lease,
    ],
  });

  return lease;
};

export const removeReservedIpLease = async (
  config: AgentConfig,
  frpsId: string,
) => {
  const state = await loadReservedIpState(config);
  const lease = state.leases.find((existing) => existing.frpsId === frpsId) ?? null;

  if (!lease) {
    return null;
  }

  await saveReservedIpState(config, {
    version: 1,
    leases: state.leases.filter((existing) => existing.frpsId !== frpsId),
  });

  return lease;
};
