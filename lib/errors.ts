export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, 404);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, 403);
  }
}

/** A READER request carrying the spoiler-peek flag is rejected, never honored. */
export class PeekForbiddenError extends ForbiddenError {
  constructor() {
    super("Spoiler peek is not available to readers");
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super(`Too many attempts. Try again in ${retryAfterSeconds}s.`, 429);
  }
}
