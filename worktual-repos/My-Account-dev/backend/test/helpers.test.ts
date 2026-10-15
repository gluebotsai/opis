import { describe, expect, it } from "vitest";
import { AppError, NotFoundError } from "../src/helpers/errors.js";
import { paginated, parsePagination } from "../src/helpers/pagination.js";

describe("application errors", () => {
  it("preserves stable HTTP and machine-readable fields", () => {
    const error = new NotFoundError("Invoice");
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("Invoice not found");
  });
});

describe("pagination", () => {
  it("coerces query strings and calculates an offset", () => {
    expect(parsePagination({ page: "3", pageSize: "20" })).toEqual({
      page: 3,
      pageSize: 20,
      limit: 20,
      offset: 40,
    });
  });

  it("builds stable response metadata", () => {
    const pagination = parsePagination({ page: 1, pageSize: 2 });
    expect(paginated(["a", "b"], 5, pagination).meta.pageCount).toBe(3);
  });
});
