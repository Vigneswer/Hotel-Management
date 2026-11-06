import { describe, expect, it } from "vitest";
import { assertTestDatabase } from "./testing.js";

describe("test database safety", () => {
  it("accepts an isolated _test database in test mode", () => {
    expect(() => assertTestDatabase("hotel_reservations_test", "test")).not.toThrow();
  });
  it.each([
    ["hotel_dev", "test"], ["hotel_prod", "test"], ["hotel_test", "development"], ["production", "test"],
  ])("rejects unsafe target %s in %s mode", (database, env) => {
    expect(() => assertTestDatabase(database, env)).toThrow(/Unsafe test database target/);
  });
});
