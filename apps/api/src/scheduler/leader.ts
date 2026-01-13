import { Client } from "pg";

const LOCK_KEY = "arkeo-racing-scheduler";
const CHECK_INTERVAL_MS = 5000;

type LeaderCallbacks = {
  onLeader: () => void | Promise<void>;
  onFollower: () => void | Promise<void>;
};

let leaderClient: Client | null = null;
let leaderInterval: NodeJS.Timeout | null = null;
let isLeader = false;
let checking = false;

async function tryAcquireLock(): Promise<boolean> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL missing for leader election");
  }

  const client = new Client({ connectionString });
  await client.connect();
  const result = await client.query(
    "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
    [LOCK_KEY]
  );

  const locked = Boolean(result.rows[0]?.locked);
  if (locked) {
    leaderClient = client;
    return true;
  }

  await client.end();
  return false;
}

async function releaseLock(): Promise<void> {
  if (!leaderClient) return;
  try {
    await leaderClient.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_KEY]);
  } catch (error) {
    // Ignore unlock errors; connection may already be closed.
  }
  try {
    await leaderClient.end();
  } catch (error) {
    // Ignore close errors.
  }
  leaderClient = null;
}

async function checkLeader(callbacks: LeaderCallbacks): Promise<void> {
  if (checking) return;
  checking = true;

  try {
    if (leaderClient) {
      try {
        await leaderClient.query("SELECT 1");
        return;
      } catch (error) {
        await releaseLock();
        if (isLeader) {
          isLeader = false;
          await callbacks.onFollower();
        }
      }
    }

    const acquired = await tryAcquireLock();
    if (acquired && !isLeader) {
      isLeader = true;
      await callbacks.onLeader();
    }
  } finally {
    checking = false;
  }
}

export async function startLeaderElection(callbacks: LeaderCallbacks): Promise<void> {
  await checkLeader(callbacks);
  leaderInterval = setInterval(() => checkLeader(callbacks), CHECK_INTERVAL_MS);
}

export async function stopLeaderElection(): Promise<void> {
  if (leaderInterval) {
    clearInterval(leaderInterval);
    leaderInterval = null;
  }

  if (isLeader) {
    isLeader = false;
  }

  await releaseLock();
}

export function isLeaderActive(): boolean {
  return isLeader;
}
