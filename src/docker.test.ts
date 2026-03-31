import { expect, test } from "bun:test";
import { parseContainerState } from "./docker";

test("parseContainerState treats a missing container as absent", () => {
  const state = parseContainerState("conduit-frps-edge", {
    stdout: "",
    stderr: "Error response from daemon: No such container: conduit-frps-edge",
    exitCode: 1,
  });

  expect(state).toBe("missing");
});

test("parseContainerState rejects daemon connectivity failures", () => {
  expect(() =>
    parseContainerState("conduit-frps-edge", {
      stdout: "",
      stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?",
      exitCode: 1,
    }),
  ).toThrow("Unable to inspect container conduit-frps-edge");
});

test("parseContainerState accepts stopped containers", () => {
  const state = parseContainerState("conduit-frps-edge", {
    stdout: "false",
    stderr: "",
    exitCode: 0,
  });

  expect(state).toBe("stopped");
});
