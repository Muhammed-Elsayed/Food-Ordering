// Errors whose status, name, message, and details are safe to send to the client as-is.
export class WebError extends Error {
  constructor(
    public readonly status: number, name: string, message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = name;
  }

  static BadRequest(message: string, details?: Record<string, unknown>) {
    return new WebError(400, "BadRequestError", message, details);
  }

  static UnAuthorized(message: string) {
    return new WebError(401, "UnauthorizedError", message);
  }

  static Forbidden(message: string) {
    return new WebError(403, "ForbiddenError", message);
  }

  static NotFound(message: string) {
    return new WebError(404, "NotFoundError", message);
  }

  static Conflict(message: string, details?: Record<string, unknown>) {
    return new WebError(409, "ConflictError", message, details);
  }

  static TooManyRequests(message: string) {
    return new WebError(429, "TooManyRequestsError", message);
  }
}
