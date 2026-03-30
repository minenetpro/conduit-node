import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { NodeState } from "./types";
import type { AgentConfig } from "./config";

export const ensureStateDirs = async (config: AgentConfig) => {
  await mkdir(config.stateDir, { recursive: true });
  await mkdir(config.frpsConfigDir, { recursive: true });
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
  await writeFile(config.stateFile, JSON.stringify(state, null, 2));
};
