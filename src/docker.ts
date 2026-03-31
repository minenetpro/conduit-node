import { access } from "node:fs/promises";

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type ContainerState = "running" | "stopped" | "missing";

export const runCommand = async (
  command: string[],
  allowFailure = false,
): Promise<CommandResult> => {
  const proc = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0 && !allowFailure) {
    throw new Error(
      `Command failed (${command.join(" ")}): ${stderr.trim() || stdout.trim()}`,
    );
  }

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode,
  };
};

export const getDockerVersion = async () => {
  try {
    const result = await runCommand(
      ["docker", "version", "--format", "{{.Server.Version}}"],
      true,
    );
    return result.exitCode === 0 ? result.stdout : null;
  } catch {
    return null;
  }
};

export const countManagedContainers = async () => {
  const result = await runCommand(
    ["docker", "ps", "--filter", "label=io.conduit.managed=true", "-q"],
    true,
  );

  if (result.exitCode !== 0 || !result.stdout) {
    return 0;
  }

  return result.stdout.split("\n").filter(Boolean).length;
};

export const parseContainerState = (
  containerName: string,
  result: CommandResult,
): ContainerState => {
  if (result.exitCode === 0) {
    if (result.stdout === "true") {
      return "running";
    }

    if (result.stdout === "false") {
      return "stopped";
    }
  }

  const detail = result.stderr || result.stdout;
  if (/no such (container|object)/i.test(detail)) {
    return "missing";
  }

  throw new Error(
    `Unable to inspect container ${containerName}: ${detail || "unknown Docker error"}`,
  );
};

const inspectContainerState = async (containerName: string): Promise<ContainerState> =>
  parseContainerState(
    containerName,
    await runCommand(
      [
        "docker",
        "inspect",
        "--format",
        "{{.State.Running}}",
        containerName,
      ],
      true,
    ),
  );

export const listManagedFrpsContainers = async () => {
  const result = await runCommand(
    [
      "docker",
      "ps",
      "--filter",
      "label=io.conduit.managed=true",
      "--format",
      '{{.Names}}\t{{.Label "io.conduit.frps_id"}}',
    ],
    true,
  );

  if (result.exitCode !== 0 || !result.stdout) {
    return [];
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [containerName, frpsId] = line.split("\t");
      return {
        containerName,
        frpsId,
      };
    })
    .filter(
      (
        container,
      ): container is {
        containerName: string;
        frpsId: string;
      } => Boolean(container.containerName) && Boolean(container.frpsId),
    );
};

export const stopContainer = async (containerName: string) => {
  await runCommand(["docker", "stop", containerName], true);

  const state = await inspectContainerState(containerName);
  if (state === "running") {
    throw new Error(`Container ${containerName} is still running after docker stop.`);
  }
};

export const removeContainer = async (containerName: string) => {
  await runCommand(["docker", "rm", "-f", containerName], true);

  const state = await inspectContainerState(containerName);
  if (state !== "missing") {
    throw new Error(`Container ${containerName} still exists after docker rm -f.`);
  }
};

export const runFrpsContainer = async (input: {
  containerName: string;
  frpsId: string;
  image: string;
  configPath: string;
}) => {
  await removeContainer(input.containerName);
  await runCommand([
    "docker",
    "run",
    "-d",
    "--name",
    input.containerName,
    "--pull",
    "always",
    "--restart",
    "unless-stopped",
    "--network",
    "host",
    "--label",
    "io.conduit.managed=true",
    "--label",
    `io.conduit.frps_id=${input.frpsId}`,
    "-v",
    `${input.configPath}:/etc/frp/frps.toml:ro`,
    input.image,
    "-c",
    "/etc/frp/frps.toml",
  ]);
};

export const probeContainerRunning = async (containerName: string) => {
  return (await inspectContainerState(containerName)) === "running";
};

export const ensureFileReadable = async (path: string) => {
  await access(path);
};
