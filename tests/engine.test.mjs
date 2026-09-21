import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const Engine = createRequire(import.meta.url)("../js/engine.js");
const load = (f) =>
  JSON.parse(readFileSync(new URL("../data/" + f, import.meta.url), "utf8"));
const eng = Engine.create({
  cross: load("cross.json"),
  survival: load("survival.json"),
});

const close = (a, b) =>
  assert.ok(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const P = {
  uboi: 36,
  weightKg: 4,
  conv: 1.2,
  posadka: 50000,
  recipes: { "0-6": 45, "7-24": 41.99, "25-34": 40, "35-42": 38.01 },
};

test("в день убоя вес и конверсия равны параметрам", () => {
  const s = eng.simulate(P).series[36];
  close(s.weight, 4000);
  close(s.conv, 1.2);
});

test("индекс в день убоя = конверсия × цена рецепта 35-42", () => {
  close(eng.simulate(P).indexLast, 1.2 * 38.01);
});

test("стоимость на день убоя = сумма карточек групп", () => {
  const r = eng.simulate(P);
  close(
    r.series[36].cost,
    r.groups.reduce((a, g) => a + g.cost, 0),
  );
});

test("после убоя значения пустые", () => {
  assert.equal(eng.simulate(P).series[37].weight, null);
});
