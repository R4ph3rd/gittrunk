import { test } from "node:test";
import assert from "node:assert/strict";
import { androidVersionCodeError } from "./check-version.mjs";

test("accepts versions whose minor and patch fit the versionCode", () => {
  assert.equal(androidVersionCodeError("0.1.0"), null);
  assert.equal(androidVersionCodeError("0.999.0"), null);
  assert.equal(androidVersionCodeError("1.2.999-rc.1"), null);
});

test("rejects minor or patch >= 1000", () => {
  assert.match(androidVersionCodeError("0.1000.0"), /below 1000/);
  assert.match(androidVersionCodeError("0.1.1000"), /below 1000/);
});
