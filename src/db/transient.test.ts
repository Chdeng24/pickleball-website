import { test } from "node:test";
import assert from "node:assert/strict";
import { isTransientDbError } from "./transient.ts";

const withCode = (code: string, message = "boom") => Object.assign(new Error(message), { code });

test("lock conflicts and dropped connections are retryable", () => {
  assert.equal(isTransientDbError(withCode("40P01")), true);
  assert.equal(isTransientDbError(withCode("40001")), true);
  assert.equal(isTransientDbError(withCode("57P01")), true);
  assert.equal(isTransientDbError(withCode("ECONNRESET")), true);
  assert.equal(isTransientDbError(new Error("Connection terminated unexpectedly")), true);
  assert.equal(isTransientDbError(new TypeError("fetch failed")), true);
});

test("looks through wrapped errors (drizzle puts the pg error in `cause`)", () => {
  const wrapped = new Error("Failed query: select ...", { cause: withCode("40P01") });
  assert.equal(isTransientDbError(wrapped), true);
});

test("app and data errors are not retried", () => {
  assert.equal(isTransientDbError(new Error("This league is full.")), false);
  assert.equal(isTransientDbError(new Error("You're already on a team in this league.")), false);
  assert.equal(isTransientDbError(withCode("23505")), false); // unique violation
  assert.equal(isTransientDbError(withCode("23503")), false); // foreign key
  assert.equal(isTransientDbError(withCode("22P02")), false); // bad uuid
  assert.equal(isTransientDbError(null), false);
  assert.equal(isTransientDbError(undefined), false);
  assert.equal(isTransientDbError("string error"), false);
});

test("a self-referencing cause chain doesn't loop forever", () => {
  const e = new Error("x") as Error & { cause?: unknown };
  e.cause = e;
  assert.equal(isTransientDbError(e), false);
});
