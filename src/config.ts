import os from "node:os";
import path from "node:path";

const env = Bun.env;

const readRequired = (name: string) => {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export type AgentConfig = {
  controllerUrl: string;
  registrationToken: string | null;
  label: string;
  hostname: string;
  vultrInstanceId: string;
  region: string;
  stateDir: string;
  stateFile: string;
  frpsConfigDir: string;
  reservedIpStateFile: string;
  heartbeatSeconds: number;
  jobPollSeconds: number;
  agentVersion: string;
};

export const loadConfig = (): AgentConfig => {
  const stateDir = env.CONDUIT_STATE_DIR ?? "/var/lib/conduit-node";

  return {
    controllerUrl: readRequired("CONDUIT_CONTROLLER_URL").replace(/\/$/, ""),
    registrationToken: env.CONDUIT_REGISTRATION_TOKEN ?? null,
    label: readRequired("CONDUIT_NODE_LABEL"),
    hostname: env.CONDUIT_HOSTNAME ?? os.hostname(),
    vultrInstanceId: readRequired("CONDUIT_VULTR_INSTANCE_ID"),
    region: readRequired("CONDUIT_VULTR_REGION"),
    stateDir,
    stateFile: path.join(stateDir, "node-state.json"),
    frpsConfigDir: path.join(stateDir, "frps"),
    reservedIpStateFile: path.join(stateDir, "reserved-ips.json"),
    heartbeatSeconds: Number(env.CONDUIT_HEARTBEAT_SECONDS ?? "15"),
    jobPollSeconds: Number(env.CONDUIT_JOB_POLL_SECONDS ?? "10"),
    agentVersion: env.CONDUIT_NODE_VERSION ?? "0.1.0",
  };
};
