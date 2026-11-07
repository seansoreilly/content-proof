#!/usr/bin/env node
/**
 * `npm run test:redis`: run the Redis integration suite against real Redis.
 *
 * With REDIS_TEST_URL and REDIS_TEST_TOKEN already set (a throwaway Upstash
 * database, or an emulator you started yourself), the suite runs against
 * that. Otherwise this starts a private redis-server (no persistence, its own
 * port) and the Upstash REST shim in front of it, runs the suite, and stops
 * both. The suite FLUSHes its database, so never point it at real data.
 *
 * Ports: REDIS_TEST_REDIS_PORT (default 6390) and REDIS_TEST_SHIM_PORT
 * (default 8079). REDIS_SERVER overrides the redis-server binary.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { RespClient, startShim } from "./upstash-rest-shim.mjs";

// Every test FLUSHes the one database, so files must not run in parallel.
const vitestArgs = ["run", "integration.test", "--no-file-parallelism", ...process.argv.slice(2)];

let vitest = null;

function runVitest(env) {
  return new Promise((resolve) => {
    vitest = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", ...vitestArgs], {
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    vitest.on("exit", (code, signal) => {
      vitest = null;
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

async function answersPing(url) {
  const client = new RespClient(url);
  try {
    const [reply] = await client.send([["PING"]]);
    return reply?.value === "PONG";
  } catch {
    return false;
  } finally {
    client.close();
  }
}

/** Wait for our own redis-server; never settle for another one on the port. */
async function waitForRedis(url, server) {
  for (let i = 0; i < 100; i++) {
    if (server.spawnError) throw new Error(`could not start redis-server: ${server.spawnError.message}`);
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`redis-server exited before answering (port taken, or bad arguments?)`);
    }
    if (await answersPing(url)) return;
    await delay(100);
  }
  throw new Error(`redis-server at ${url} did not answer PING`);
}

async function main() {
  if (process.env.REDIS_TEST_URL && process.env.REDIS_TEST_TOKEN) {
    console.log(`[test:redis] using REDIS_TEST_URL=${process.env.REDIS_TEST_URL}`);
    return runVitest({});
  }

  const redisPort = Number(process.env.REDIS_TEST_REDIS_PORT ?? 6390);
  const shimPort = Number(process.env.REDIS_TEST_SHIM_PORT ?? 8079);
  const token = "test-token";
  const redisUrl = `redis://127.0.0.1:${redisPort}`;
  // The suite FLUSHes the database: refuse to start next to someone else's Redis.
  if (await answersPing(redisUrl)) {
    throw new Error(`Something already answers on port ${redisPort}; set REDIS_TEST_REDIS_PORT to a free port`);
  }
  const dir = mkdtempSync(join(tmpdir(), "contentproof-redis-"));
  const server = spawn(
    process.env.REDIS_SERVER ?? "redis-server",
    ["--port", String(redisPort), "--bind", "127.0.0.1", "--save", "", "--appendonly", "no", "--dir", dir],
    { stdio: ["ignore", "ignore", "inherit"] }
  );
  server.on("error", (error) => {
    server.spawnError = error;
  });

  let shim;
  const cleanup = async () => {
    vitest?.kill("SIGTERM");
    await shim?.close();
    if (server.exitCode === null && server.signalCode === null) server.kill("SIGTERM");
    rmSync(dir, { recursive: true, force: true });
  };
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    process.once(signal, () => cleanup().finally(() => process.exit(code)));
  }

  try {
    await waitForRedis(redisUrl, server);
    shim = await startShim({ port: shimPort, redisUrl, token });
    console.log(`[test:redis] redis-server :${redisPort}, Upstash REST shim ${shim.url}`);
    return await runVitest({ REDIS_TEST_URL: shim.url, REDIS_TEST_TOKEN: token });
  } finally {
    await cleanup();
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error("[test:redis]", error);
    process.exit(1);
  }
);
