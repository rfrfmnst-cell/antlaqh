import test from "node:test";
import assert from "node:assert/strict";
import { getLaunchOffer, claimPromotion, priceBreakdown } from "../lib/promotion.js";

test("launch offer lasts October in Riyadh and rejects new claims at its boundary", () => {
  const start = Date.parse("2026-10-01T00:00:00+03:00");
  const end = Date.parse("2026-11-01T00:00:00+03:00");
  assert.equal(getLaunchOffer(start - 1).active, false);
  assert.equal(getLaunchOffer(start).active, true);
  assert.equal(getLaunchOffer(end - 1).active, true);
  assert.equal(getLaunchOffer(end).active, false);
  assert.throws(() => claimPromotion("ANTLAQH20", start - 1), /لم يبدأ/);
  assert.throws(() => claimPromotion("ANTLAQH20", end), /انتهى/);
  assert.equal(claimPromotion("  antlaqh20 ", start).ratePercent, 20);
  assert.equal(claimPromotion("", start), null);
  assert.throws(() => claimPromotion({ code: "ANTLAQH20" }, start), /الصحيح/);
  assert.throws(() => claimPromotion("FAKE100", start), /غير صحيح/);
});
test("discount rounds to halalas and a claimed snapshot can price a later quote once", () => {
  const snapshot = claimPromotion("ANTLAQH20", Date.parse("2026-10-01T12:00:00+03:00"));
  assert.deepEqual(priceBreakdown(99999, snapshot), { subtotal: 99999, discount: 20000, amount: 79999 });
  assert.deepEqual(priceBreakdown(200000, snapshot), { subtotal: 200000, discount: 40000, amount: 160000 });
  assert.deepEqual(priceBreakdown(10000), { subtotal: 10000, discount: 0, amount: 10000 });
  assert.throws(() => priceBreakdown(NaN, snapshot));
  assert.throws(() => priceBreakdown(-1, snapshot));
});
