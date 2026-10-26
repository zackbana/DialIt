"use client";
import { openDB, type DBSchema } from "idb";
import type { Sample, ReactionSample } from "./protocol";
interface QueueSchema extends DBSchema {
  ratings: { key: string; value: { key: string; owner: string; sample: Sample }; indexes: { owner: string } };
  reactions: { key: string; value: { key: string; owner: string; sample: ReactionSample }; indexes: { owner: string } };
  sequences: { key: string; value: number };
}
const database = () => openDB<QueueSchema>("dialit-capture-v1", 2, { upgrade(db, oldVersion, _newVersion, tx) {
  if (oldVersion < 1) {
    db.createObjectStore("ratings", { keyPath: "key" });
    db.createObjectStore("reactions", { keyPath: "key" });
    db.createObjectStore("sequences");
  }
  if (oldVersion < 2) {
    tx.objectStore("ratings").createIndex("owner", "owner");
    tx.objectStore("reactions").createIndex("owner", "owner");
  }
} });
export async function saveRating(owner: string, sample: Omit<Sample, "sequence">) {
  const db = await database();
  try {
    const tx = db.transaction(["ratings", "sequences"], "readwrite");
    const sequenceKey = `${owner}:${sample.runId}`;
    const sequence = (await tx.objectStore("sequences").get(sequenceKey)) ?? 0;
    await tx.objectStore("ratings").add({ key: `${sequenceKey}:${sequence}`, owner, sample: { ...sample, sequence } });
    await tx.objectStore("sequences").put(sequence + 1, sequenceKey);
    await tx.done;
  } finally { db.close(); }
}
export async function saveReaction(owner: string, sample: ReactionSample) {
  const db = await database();
  try {
    const tx = db.transaction(["reactions", "sequences"], "readwrite");
    await tx.objectStore("reactions").add({ key: sample.id, owner, sample });
    const key = `reaction-count:${owner}:${sample.runId}`;
    const count = (await tx.objectStore("sequences").get(key)) ?? 0;
    await tx.objectStore("sequences").put(count + 1, key); await tx.done;
  } finally { db.close(); }
}
export async function initialiseRun(owner: string, runId: string) {
  const db = await database();
  try {
    const tx = db.transaction("sequences", "readwrite"), key = `${owner}:${runId}`;
    if (await tx.store.get(key) === undefined) await tx.store.put(0, key);
    await tx.done;
  } finally { db.close(); }
}
export async function captureTotals(owner: string) {
  const db = await database();
  try {
    const keys = await db.getAllKeys("sequences");
    const result = [];
    for (const key of keys.filter((key) => key.startsWith(`${owner}:`))) {
      const runId = key.slice(owner.length + 1);
      result.push({ runId, expectedRatings: (await db.get("sequences", key)) ?? 0, expectedReactions: (await db.get("sequences", `reaction-count:${owner}:${runId}`)) ?? 0 });
    }
    return result;
  } finally { db.close(); }
}
export async function readPending(owner: string) {
  const db = await database();
  try {
    const ratings = await db.getAllFromIndex("ratings", "owner", owner, 120);
    const reactions = await db.getAllFromIndex("reactions", "owner", owner, 120);
    const count = (await db.countFromIndex("ratings", "owner", owner)) + (await db.countFromIndex("reactions", "owner", owner));
    return { ratings: ratings.map((record) => record.sample), reactions: reactions.map((record) => record.sample), count };
  } finally { db.close(); }
}
export async function acknowledge(owner: string, result: { ratings: { runId: string; sequence: number }[]; reactions: string[] }) {
  const db = await database();
  try {
    const tx = db.transaction(["ratings", "reactions"], "readwrite");
    for (const record of result.ratings) await tx.objectStore("ratings").delete(`${owner}:${record.runId}:${record.sequence}`);
    for (const id of result.reactions) await tx.objectStore("reactions").delete(id);
    await tx.done;
  } finally { db.close(); }
}
