import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const frontendRoot = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const valueFor = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const port = valueFor("--port", process.env.PORT ?? "3000");
const hostname = valueFor("--hostname", "127.0.0.1");
if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) {
  console.error(
    "Standalone start is local-only; use 127.0.0.1, localhost, or ::1.",
  );
  process.exit(2);
}

const standaloneRoot = join(frontendRoot, ".next", "standalone");
await mkdir(join(standaloneRoot, ".next"), { recursive: true });
await cp(
  join(frontendRoot, ".next", "static"),
  join(standaloneRoot, ".next", "static"),
  { recursive: true },
);
await cp(join(frontendRoot, "public"), join(standaloneRoot, "public"), {
  recursive: true,
  force: true,
}).catch(() => {});

const child = spawn(process.execPath, [join(standaloneRoot, "server.js")], {
  cwd: standaloneRoot,
  env: {
    ...process.env,
    PORT: String(port),
    HOSTNAME: hostname,
    NODE_ENV: "production",
  },
  stdio: "inherit",
});
const stop = (signal) => child.kill(signal);
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
