import { expect, test } from "bun:test";
import { renderFrpsConfig } from "./frps";
import type { AgentJob } from "./types";

test("renderFrpsConfig emits host-bound token-auth config", () => {
  const job: AgentJob = {
    _id: "job_123",
    kind: "provision_frps",
    attemptCount: 1,
    payload: {
      frpsId: "frps_123",
      name: "edge-frps",
      containerName: "conduit-frps-edge",
      reservedIp: "203.0.113.10",
      bindPort: 7000,
      proxyPortStart: 1024,
      proxyPortEnd: 49151,
      authToken: "secret-token",
      image: "ghcr.io/fatedier/frps:v0.65.0",
    },
  };

  const rendered = renderFrpsConfig(job);

  expect(rendered).toContain('bindAddr = "203.0.113.10"');
  expect(rendered).toContain("bindPort = 7000");
  expect(rendered).toContain('proxyBindAddr = "203.0.113.10"');
  expect(rendered).toContain('method = "token"');
  expect(rendered).toContain('token = "secret-token"');
  expect(rendered).toContain("allowPorts = [{ start = 1024, end = 49151 }]");
});
