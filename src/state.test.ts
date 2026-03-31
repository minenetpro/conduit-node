import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentConfig } from "./config";
import {
  ensureStateDirs,
  loadReservedIpState,
  removeReservedIpLease,
  upsertReservedIpLease,
} from "./state";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

const createConfig = async (): Promise<AgentConfig> => {
  const stateDir = await mkdtemp(path.join(tmpdir(), "conduit-node-test-"));
  tempDirs.push(stateDir);

  return {
    controllerUrl: "http://localhost:3000",
    registrationToken: "reg-token",
    label: "test-node",
    hostname: "test-host",
    vultrInstanceId: "instance-123",
    region: "dfw",
    stateDir,
    stateFile: path.join(stateDir, "node-state.json"),
    frpsConfigDir: path.join(stateDir, "frps"),
    reservedIpStateFile: path.join(stateDir, "reserved-ips.json"),
    heartbeatSeconds: 15,
    jobPollSeconds: 10,
    agentVersion: "0.1.0",
  };
};

test("reserved IP leases round-trip through state", async () => {
  const config = await createConfig();
  await ensureStateDirs(config);

  await upsertReservedIpLease(config, {
    frpsId: "frps_123",
    address: "216.128.135.193",
    status: "active",
  });

  let state = await loadReservedIpState(config);
  expect(state.leases).toHaveLength(1);
  expect(state.leases[0]?.status).toBe("active");

  await removeReservedIpLease(config, "frps_123");

  state = await loadReservedIpState(config);
  expect(state.leases).toHaveLength(0);
});

test("invalid reserved IP state fails loudly", async () => {
  const config = await createConfig();
  await ensureStateDirs(config);

  await writeFile(
    config.reservedIpStateFile,
    JSON.stringify({ version: 1, leases: [{ frpsId: "x" }] }),
  );

  await expect(loadReservedIpState(config)).rejects.toThrow(
    "Reserved IP state file contains an invalid lease.",
  );
});
