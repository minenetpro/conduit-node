import { access } from "node:fs/promises";

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

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

export const stopContainer = async (containerName: string) => {
  await runCommand(["docker", "stop", containerName], true);
};

export const removeContainer = async (containerName: string) => {
  await runCommand(["docker", "rm", "-f", containerName], true);
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
  const result = await runCommand(
    [
      "docker",
      "inspect",
      "--format",
      "{{.State.Running}}",
      containerName,
    ],
    true,
  );

  return result.exitCode === 0 && result.stdout === "true";
};

export const ensureFileReadable = async (path: string) => {
  await access(path);
};
