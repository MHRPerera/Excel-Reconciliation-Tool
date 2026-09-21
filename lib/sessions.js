const fs = require("fs");
const path = require("path");
const { v4: uuid } = require("uuid");

const DATA_DIR = path.join(__dirname, "..", "data");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const SESSION_TTL_MS = 60 * 60 * 1000; // auto-cleanup after 1 hour

const sessions = new Map(); // sessionId -> { dir, files: {a,b}, job }

function createSession() {
  const id = uuid();
  const dir = path.join(SESSIONS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const session = { id, dir, files: {}, job: { phase: "idle" } };
  sessions.set(id, session);

  setTimeout(() => destroySession(id), SESSION_TTL_MS).unref();
  return session;
}

function getSession(id) {
  return sessions.get(id);
}

function destroySession(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  fs.rm(s.dir, { recursive: true, force: true }, () => {});
}

module.exports = { createSession, getSession, destroySession, SESSIONS_DIR };
