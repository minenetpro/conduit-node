export type NodeState = {
  nodeId: string;
  agentToken: string;
  registeredAt: number;
};

export type AgentJobPayload = {
  frpsId: string;
  name: string;
  containerName: string;
  reservedIp: string;
  bindPort: number;
  proxyPortStart: number;
  proxyPortEnd: number;
  authToken: string;
  image: string;
};

export type AgentJob = {
  _id: string;
  kind:
    | "provision_frps"
    | "start_frps"
    | "stop_frps"
    | "restart_frps"
    | "delete_frps";
  payload: AgentJobPayload;
  attemptCount: number;
};

export type JobCompletion = {
  status: "succeeded" | "failed";
  message: string;
  containerName?: string;
};
