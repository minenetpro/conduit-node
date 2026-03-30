import type { AgentConfig } from "./config";
import type { AgentJob, JobCompletion, NodeState } from "./types";

const postJson = async <T>(
  url: string,
  payload: unknown,
): Promise<T> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => null)) as
    | ({ error?: string } & T)
    | null;

  if (!response.ok) {
    throw new Error(data?.error ?? `Controller request failed with ${response.status}`);
  }

  return data as T;
};

export const registerNode = async (
  config: AgentConfig,
  dockerVersion: string | null,
) => {
  if (!config.registrationToken) {
    throw new Error("No registration token is configured for first boot.");
  }

  const response = await postJson<{
    nodeId: string;
    agentToken: string;
  }>(`${config.controllerUrl}/api/agent/register`, {
    registrationToken: config.registrationToken,
    label: config.label,
    hostname: config.hostname,
    vultrInstanceId: config.vultrInstanceId,
    region: config.region,
    agentVersion: config.agentVersion,
    dockerVersion,
  });

  return {
    nodeId: response.nodeId,
    agentToken: response.agentToken,
    registeredAt: Date.now(),
  };
};

export const sendHeartbeat = async (
  config: AgentConfig,
  state: NodeState,
  dockerVersion: string | null,
  runningContainers: number,
) => {
  await postJson<{ ok: true }>(`${config.controllerUrl}/api/agent/heartbeat`, {
    nodeId: state.nodeId,
    agentToken: state.agentToken,
    hostname: config.hostname,
    agentVersion: config.agentVersion,
    dockerVersion,
    runningContainers,
  });
};

export const claimJob = async (
  config: AgentConfig,
  state: NodeState,
) => {
  const response = await postJson<{
    job: AgentJob | null;
  }>(`${config.controllerUrl}/api/agent/jobs/claim`, {
    nodeId: state.nodeId,
    agentToken: state.agentToken,
  });

  return response.job;
};

export const completeJob = async (
  config: AgentConfig,
  state: NodeState,
  jobId: string,
  completion: JobCompletion,
) => {
  await postJson<{ ok: true }>(
    `${config.controllerUrl}/api/agent/jobs/${jobId}/complete`,
    {
      nodeId: state.nodeId,
      agentToken: state.agentToken,
      status: completion.status,
      message: completion.message,
      containerName: completion.containerName,
    },
  );
};
