import { connect } from "node:net";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentConfig } from "./config";
import { probeContainerRunning, removeContainer, runCommand, runFrpsContainer, stopContainer } from "./docker";
import type { AgentJob, JobCompletion } from "./types";

export const renderFrpsConfig = (job: AgentJob) => {
  const payload = job.payload;

  return [
    `bindAddr = "${payload.reservedIp}"`,
    `bindPort = ${payload.bindPort}`,
    `proxyBindAddr = "${payload.reservedIp}"`,
    `allowPorts = [{ start = ${payload.proxyPortStart}, end = ${payload.proxyPortEnd} }]`,
    "",
    `[auth]`,
    `method = "token"`,
    `token = "${payload.authToken}"`,
    "",
  ].join("\n");
};

const configPathForJob = (config: AgentConfig, job: AgentJob) =>
  path.join(config.frpsConfigDir, `${job.payload.frpsId}.toml`);

const waitForReservedIp = async (address: string, timeoutMs = 60_000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const result = await runCommand(["ip", "-4", "-o", "addr", "show"], true);
    if (result.stdout.includes(`${address}/`)) {
      return;
    }

    await Bun.sleep(1_500);
  }

  throw new Error(`Reserved IP ${address} did not appear on the host.`);
};

const probeTcp = async (host: string, port: number, timeoutMs = 5_000) =>
  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out probing ${host}:${port}`));
    }, timeoutMs);

    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.end();
      resolve();
    });

    socket.once("error", (error) => {
      clearTimeout(timeout);
      socket.destroy();
      reject(error);
    });
  });

const startLikeProvision = async (
  config: AgentConfig,
  job: AgentJob,
): Promise<JobCompletion> => {
  const configPath = configPathForJob(config, job);
  await waitForReservedIp(job.payload.reservedIp);
  await writeFile(configPath, renderFrpsConfig(job));

  await runFrpsContainer({
    containerName: job.payload.containerName,
    frpsId: job.payload.frpsId,
    image: job.payload.image,
    configPath,
  });

  const running = await probeContainerRunning(job.payload.containerName);
  if (!running) {
    throw new Error(`Container ${job.payload.containerName} failed to start.`);
  }

  await probeTcp(job.payload.reservedIp, job.payload.bindPort);

  return {
    status: "succeeded",
    message: `${job.kind} succeeded`,
    containerName: job.payload.containerName,
  };
};

export const executeJob = async (
  config: AgentConfig,
  job: AgentJob,
): Promise<JobCompletion> => {
  try {
    switch (job.kind) {
      case "provision_frps":
      case "start_frps":
      case "restart_frps":
        return await startLikeProvision(config, job);
      case "stop_frps":
        await stopContainer(job.payload.containerName);
        return {
          status: "succeeded",
          message: "stop_frps succeeded",
          containerName: job.payload.containerName,
        };
      case "delete_frps":
        await removeContainer(job.payload.containerName);
        await rm(configPathForJob(config, job), { force: true });
        return {
          status: "succeeded",
          message: "delete_frps succeeded",
          containerName: job.payload.containerName,
        };
      default:
        throw new Error(`Unsupported job kind: ${job.kind satisfies never}`);
    }
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "Job execution failed.",
      containerName: job.payload.containerName,
    };
  }
};
