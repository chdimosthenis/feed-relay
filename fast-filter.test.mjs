import { test } from "node:test";
import assert from "node:assert/strict";
import { selectTargets } from "./fast-filter.mjs";

const ALL = [{ source: "Seleo" }, { source: "SKAI" }, { source: "Pelop" }];

test("no RELAY_ONLY relays everything and is not fast", () => {
  const r = selectTargets(ALL, "");
  assert.equal(r.fast, false);
  assert.equal(r.targets.length, 3);
});

test("a list relays only those and is fast", () => {
  const r = selectTargets(ALL, "Seleo, Pelop");
  assert.equal(r.fast, true);
  assert.deepEqual(r.targets.map((t) => t.source), ["Seleo", "Pelop"]);
  assert.deepEqual(r.unknown, []);
});

test("an unknown name is reported so the run can fail loudly", () => {
  const r = selectTargets(ALL, "Seleo,Nope");
  assert.deepEqual(r.unknown, ["Nope"]);
  assert.equal(r.targets.length, 1);
});

test("the shipped targets.json contains every fast source the Worker sends", async () => {
  const { readFileSync } = await import("node:fs");
  const all = JSON.parse(readFileSync(new URL("./targets.json", import.meta.url), "utf8"));
  const r = selectTargets(all, "Seleo,Pelop,Thesstoday,OTA VOICE");
  assert.deepEqual(r.unknown, []);
  assert.equal(r.targets.length, 4);
});
