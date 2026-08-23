import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  verifyStripeSignature,
} from "../functions/_shared/stripe-security.mjs";

const secret = "whsec_test_contract_only";
const payload = JSON.stringify({ id: "evt_contract", type: "checkout.session.completed" });

function signature(body, timestamp, signingSecret = secret) {
  return createHmac("sha256", signingSecret).update(`${timestamp}.${body}`).digest("hex");
}

test("accepts a current Stripe signature over the exact raw body", async () => {
  const now = 1_800_000_000;
  const header = `t=${now},v1=${signature(payload, now)}`;

  assert.equal(await verifyStripeSignature(payload, header, secret, now), true);
});

test("rejects tampering, stale signatures, and the wrong signing secret", async () => {
  const now = 1_800_000_000;
  const valid = signature(payload, now);

  assert.equal(await verifyStripeSignature(`${payload} `, `t=${now},v1=${valid}`, secret, now), false);
  assert.equal(await verifyStripeSignature(payload, `t=${now - 301},v1=${signature(payload, now - 301)}`, secret, now), false);
  assert.equal(await verifyStripeSignature(payload, `t=${now},v1=${valid}`, "wrong-secret", now), false);
});

test("accepts a valid rotating v1 signature when another v1 value is invalid", async () => {
  const now = 1_800_000_000;
  const header = `t=${now},v1=${"0".repeat(64)},v1=${signature(payload, now)}`;

  assert.equal(await verifyStripeSignature(payload, header, secret, now), true);
});

test("checkout attaches carrier identity to the subscription for race-safe provisioning", async () => {
  const source = await readFile(
    new URL("../functions/api/stripe/create-checkout-session.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /subscription_data\[metadata\]\[carrier_id\]/);
  assert.match(source, /subscription_data\[metadata\]\[plan\]/);
});

test("webhook delegates signature verification to the rotation-safe helper", async () => {
  const source = await readFile(
    new URL("../functions/api/stripe/webhook.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /import \{ verifyStripeSignature \} from "\.\.\/\.\.\/_shared\/stripe-security\.mjs"/);
  assert.doesNotMatch(source, /async function verifyStripeSignature/);
});

test("webhook reserves and completes events in the canonical ledger", async () => {
  const source = await readFile(
    new URL("../functions/api/stripe/webhook.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /store\.insert\("compass_stripe_events"/);
  assert.match(source, /supa\.update\("compass_stripe_events"/);
});

test("Supabase minimal inserts tolerate the empty successful response", async () => {
  const source = await readFile(
    new URL("../functions/_shared/supabase-admin.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /const text = await r\.text\(\);/);
  assert.match(source, /text\.trim\(\) \? JSON\.parse\(text\) as unknown\[\] : \[\]/);
});
