import { describe, expect, it } from "vitest";
import { READER_CORE_SCAFFOLD } from "@montree/reader-core";

describe("reader-core scaffold", () => {
  it("exports READER_CORE_SCAFFOLD", () => {
    expect(READER_CORE_SCAFFOLD).toBe("reader-core:contracts");
  });
});
