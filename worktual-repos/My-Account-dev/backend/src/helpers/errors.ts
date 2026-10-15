export class AppError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  public constructor(resource = "Resource") {
    super(404, "NOT_FOUND", `${resource} not found`);
  }
}

export class UnauthorizedError extends AppError {
  public constructor(message = "Authentication required") {
    super(401, "UNAUTHORIZED", message);
  }
}

export class ConflictError extends AppError {
  public constructor(message: string, details?: unknown) {
    super(409, "CONFLICT", message, details);
  }
}
