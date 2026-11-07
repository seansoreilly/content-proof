#!/usr/bin/env node
/**
 * A minimal stand-in for the Upstash Redis REST API, in front of a real
 * redis-server, so the Redis integration tests exercise genuine Redis (Lua,
 * cjson, MULTI, nil and error replies) through the real `@upstash/redis`
 * client. The official emulator (hiett/serverless-redis-http) needs Docker;
 * this needs only Node and redis-server.
 *
 * It serves exactly what `@upstash/redis` uses (see its pkg/http.ts and
 * pkg/pipeline.ts):
 *
 *   POST /             body ["CMD", ...args]          -> {result} | 400 {error}
 *   POST /pipeline     body [["CMD", ...], ...]       -> [{result} | {error}, ...]
 *   POST /multi-exec   body [["CMD", ...], ...]       -> [{result} | {error}, ...]
 *                                                       | 400 {error} if aborted
 *
 * Every request needs `Authorization: Bearer <token>` (401 otherwise). The
 * client sends `Upstash-Encoding: base64` by default; then every string in a
 * result (bulk or status reply, at any depth) is base64 of its bytes, except
 * the status reply "OK", while integers and nil stay JSON numbers and null.
 * Error messages are never encoded. Replies follow RESP2, so ZRANGE WITHSCORES
 * is a flat array and a Lua `false` is nil, as on Upstash.
 *
 * One RESP connection serves all requests. Each request writes all of its
 * commands in a single write, and replies come back in order, so a
 * MULTI ... EXEC block is never interleaved with another request's commands.
 *
 * Usage: node scripts/upstash-rest-shim.mjs [--port 8079] [--redis redis://127.0.0.1:6379/0] [--token test]
 * (or SHIM_PORT, SHIM_REDIS_URL, SHIM_TOKEN). It is a test fixture, never a
 * production component.
 */
import { createServer } from "node:http";
import { connect } from "node:net";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------- RESP client

class RespError {
  constructor(message) {
    this.message = message;
  }
}

/** Status replies (`+OK`) are kept apart from bulk strings so "OK" can stay unencoded. */
class Status {
  constructor(value) {
    this.value = value;
  }
}

const CRLF = Buffer.from("\r\n");

function encodeCommand(args) {
  const parts = [Buffer.from(`*${args.length}\r\n`)];
  for (const arg of args) {
    const buf = Buffer.isBuffer(arg) ? arg : Buffer.from(String(arg), "utf8");
    parts.push(Buffer.from(`$${buf.length}\r\n`), buf, CRLF);
  }
  return Buffer.concat(parts);
}

/** Parse one RESP2 value at `offset`; undefined when the buffer holds only part of it. */
function parseReply(buf, offset) {
  if (offset >= buf.length) return undefined;
  const lineEnd = buf.indexOf(CRLF, offset);
  if (lineEnd === -1) return undefined;
  const type = String.fromCharCode(buf[offset]);
  const line = buf.toString("utf8", offset + 1, lineEnd);
  const next = lineEnd + 2;
  switch (type) {
    case "+":
      return [new Status(line), next];
    case "-":
      return [new RespError(line), next];
    case ":":
      return [Number(line), next];
    case "$": {
      const length = Number(line);
      if (length === -1) return [null, next];
      if (buf.length < next + length + 2) return undefined;
      return [buf.subarray(next, next + length), next + length + 2];
    }
    case "*": {
      const count = Number(line);
      if (count === -1) return [null, next];
      const items = [];
      let at = next;
      for (let i = 0; i < count; i++) {
        const parsed = parseReply(buf, at);
        if (!parsed) return undefined;
        items.push(parsed[0]);
        at = parsed[1];
      }
      return [items, at];
    }
    default:
      throw new Error(`Unexpected RESP type byte ${JSON.stringify(type)}`);
  }
}

export class RespClient {
  constructor(redisUrl) {
    const url = new URL(redisUrl);
    this.host = url.hostname || "127.0.0.1";
    this.port = Number(url.port || 6379);
    this.password = url.password ? decodeURIComponent(url.password) : null;
    this.username = url.username ? decodeURIComponent(url.username) : null;
    const db = url.pathname.replace(/^\//, "");
    this.db = db ? Number(db) : 0;
    this.socket = null;
    this.state = null;
    this.connecting = null;
  }

  /**
   * Open the connection (and AUTH/SELECT) once; concurrent callers share the
   * attempt. Commands are only accepted once setup has succeeded, so a failed
   * SELECT can never leave requests running against database 0.
   */
  connect() {
    if (this.socket) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const attempt = new Promise((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      socket.setNoDelay(true);
      // Pending replies of this socket only; a newer socket has its own.
      const state = { pending: [], buffer: Buffer.alloc(0), dead: false };
      const fail = (error) => {
        if (state.dead) return;
        state.dead = true;
        socket.destroy();
        if (this.socket === socket) this.socket = null;
        if (this.connecting === attempt) this.connecting = null;
        for (const p of state.pending.splice(0)) p.reject(error);
        reject(error);
      };
      socket.on("error", fail);
      socket.on("close", () => fail(new Error("Redis connection closed")));
      socket.on("data", (chunk) => {
        try {
          this.onData(state, chunk);
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      });
      socket.once("connect", () => {
        const setup = [];
        if (this.password) setup.push(this.username ? ["AUTH", this.username, this.password] : ["AUTH", this.password]);
        if (this.db) setup.push(["SELECT", String(this.db)]);
        const ready = () => {
          this.socket = socket;
          this.state = state;
          if (this.connecting === attempt) this.connecting = null;
          resolve();
        };
        if (setup.length === 0) return ready();
        this.write(socket, state, setup).then((replies) => {
          const error = replies.find((r) => r instanceof RespError);
          if (error) fail(new Error(error.message));
          else ready();
        }, fail);
      });
    });
    this.connecting = attempt;
    return attempt;
  }

  onData(state, chunk) {
    state.buffer = state.buffer.length === 0 ? chunk : Buffer.concat([state.buffer, chunk]);
    let offset = 0;
    for (;;) {
      const parsed = parseReply(state.buffer, offset);
      if (!parsed) break;
      offset = parsed[1];
      const head = state.pending[0];
      if (!head) throw new Error("Reply from Redis with no command waiting for it");
      head.replies.push(parsed[0]);
      if (head.replies.length === head.expected) {
        state.pending.shift();
        head.resolve(head.replies);
      }
    }
    state.buffer = offset === state.buffer.length ? Buffer.alloc(0) : state.buffer.subarray(offset);
  }

  /** Write a batch of commands at once; resolves with their replies in order. */
  write(socket, state, commands) {
    return new Promise((resolve, reject) => {
      if (!socket || state.dead) return reject(new Error("Redis connection closed"));
      state.pending.push({ expected: commands.length, replies: [], resolve, reject });
      socket.write(Buffer.concat(commands.map(encodeCommand)));
    });
  }

  async send(commands) {
    await this.connect();
    return this.write(this.socket, this.state ?? { dead: true }, commands);
  }

  close() {
    this.socket?.destroy();
  }
}

// ---------------------------------------------------------- Upstash mapping

function toJsonValue(reply, base64) {
  if (reply === null || typeof reply === "number") return reply;
  if (reply instanceof Status) {
    if (reply.value === "OK" || !base64) return reply.value;
    return Buffer.from(reply.value, "utf8").toString("base64");
  }
  if (Buffer.isBuffer(reply)) return base64 ? reply.toString("base64") : reply.toString("utf8");
  if (Array.isArray(reply)) return reply.map((item) => toJsonValue(item, base64));
  // An error nested in an array (only EXEC produces these, handled separately).
  if (reply instanceof RespError) return reply.message;
  throw new Error("Unexpected reply");
}

function toEntry(reply, base64) {
  return reply instanceof RespError ? { error: reply.message } : { result: toJsonValue(reply, base64) };
}

function isCommand(value) {
  return Array.isArray(value) && value.length > 0 && value.every((a) => ["string", "number", "boolean"].includes(typeof a));
}

function toArgs(command) {
  return command.map((arg) => String(arg));
}

async function handle(redis, path, body, base64) {
  if (path === "/") {
    if (!isCommand(body)) return [400, { error: "ERR invalid command" }];
    const [reply] = await redis.send([toArgs(body)]);
    const entry = toEntry(reply, base64);
    return [entry.error === undefined ? 200 : 400, entry];
  }
  if (path === "/pipeline" || path === "/multi-exec") {
    if (!Array.isArray(body) || body.length === 0 || !body.every(isCommand)) {
      return [400, { error: "ERR invalid pipeline" }];
    }
    if (path === "/pipeline") {
      const replies = await redis.send(body.map(toArgs));
      return [200, replies.map((reply) => toEntry(reply, base64))];
    }
    const replies = await redis.send([["MULTI"], ...body.map(toArgs), ["EXEC"]]);
    const exec = replies[replies.length - 1];
    // A command rejected while queueing aborts the whole transaction.
    if (exec instanceof RespError) return [400, { error: exec.message }];
    if (exec === null) return [400, { error: "ERR transaction aborted" }];
    return [200, exec.map((reply) => toEntry(reply, base64))];
  }
  return [404, { error: "ERR unknown endpoint" }];
}

export function startShim({ port = 8079, redisUrl = "redis://127.0.0.1:6379", token = "test", host = "127.0.0.1" } = {}) {
  const redis = new RespClient(redisUrl);
  const server = createServer((req, res) => {
    const reply = (status, payload) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.headers.authorization !== `Bearer ${token}`) {
      req.resume();
      return reply(401, { error: "Unauthorized" });
    }
    if (req.method !== "POST") {
      req.resume();
      return reply(405, { error: "ERR only POST is supported" });
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return reply(400, { error: "ERR invalid JSON body" });
      }
      const base64 = String(req.headers["upstash-encoding"] ?? "").toLowerCase() === "base64";
      const path = new URL(req.url ?? "/", "http://shim").pathname.replace(/\/+$/, "") || "/";
      try {
        const [status, payload] = await handle(redis, path, body, base64);
        reply(status, payload);
      } catch (error) {
        reply(500, { error: `ERR redis unavailable: ${error instanceof Error ? error.message : String(error)}` });
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        url: `http://${host}:${typeof address === "object" && address ? address.port : port}`,
        close: () =>
          new Promise((done) => {
            redis.close();
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

function argValue(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(argValue("port") ?? process.env.SHIM_PORT ?? 8079);
  const redisUrl = argValue("redis") ?? process.env.SHIM_REDIS_URL ?? "redis://127.0.0.1:6379";
  const token = argValue("token") ?? process.env.SHIM_TOKEN ?? "test";
  startShim({ port, redisUrl, token }).then(
    ({ url }) => console.log(`[upstash-rest-shim] ${url} -> ${redisUrl}`),
    (error) => {
      console.error("[upstash-rest-shim] failed to start:", error);
      process.exit(1);
    }
  );
}
