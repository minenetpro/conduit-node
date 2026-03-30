import { loadConfig } from "./config";
import { claimJob, completeJob, registerNode, sendHeartbeat } from "./controller";
import { countManagedContainers, getDockerVersion } from "./docker";
import { executeJob } from "./frps";
import { ensureStateDirs, loadNodeState, saveNodeState } from "./state";
import type { NodeState } from "./types";

const config = loadConfig();

const ensureRegistered = async (): Promise<NodeState> => {
  const existingState = await loadNodeState(config);
  if (existingState) {
    return existingState;
  }

  const dockerVersion = await getDockerVersion();
  const state = await registerNode(config, dockerVersion);
  await saveNodeState(config, state);
  console.log(`registered node ${state.nodeId}`);
  return state;
};

const main = async () => {
  await ensureStateDirs(config);

  let state = await ensureRegistered();
  let lastHeartbeatAt = 0;

  while (true) {
    try {
      const now = Date.now();
      const dockerVersion = await getDockerVersion();
      const runningContainers = await countManagedContainers();

      if (now - lastHeartbeatAt >= config.heartbeatSeconds * 1000) {
        await sendHeartbeat(config, state, dockerVersion, runningContainers);
        lastHeartbeatAt = now;
      }

      const job = await claimJob(config, state);
      if (job) {
        console.log(`claimed ${job.kind} (${job._id})`);
        const completion = await executeJob(config, job);
        await completeJob(config, state, job._id, completion);
        continue;
      }
    } catch (error) {
      console.error(error);
    }

    await Bun.sleep(config.jobPollSeconds * 1000);
    state = (await loadNodeState(config)) ?? state;
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
