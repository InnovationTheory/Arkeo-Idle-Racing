/**
 * Base application error class.
 * All custom errors extend this class for consistent error handling.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message?: string
  ) {
    super(message ?? code);
    this.name = "AppError";
  }
}

/**
 * 400 Bad Request - Validation errors, invalid input
 */
export class ValidationError extends AppError {
  constructor(code: string, message?: string) {
    super(code, 400, message);
    this.name = "ValidationError";
  }
}

/**
 * 401 Unauthorized - Authentication required or failed
 */
export class AuthenticationError extends AppError {
  constructor(code: string = "unauthorized", message?: string) {
    super(code, 401, message);
    this.name = "AuthenticationError";
  }
}

/**
 * 404 Not Found - Resource not found
 */
export class NotFoundError extends AppError {
  constructor(code: string, message?: string) {
    super(code, 404, message);
    this.name = "NotFoundError";
  }
}

/**
 * 409 Conflict - Resource conflict (duplicate, already exists)
 */
export class ConflictError extends AppError {
  constructor(code: string, message?: string) {
    super(code, 409, message);
    this.name = "ConflictError";
  }
}

/**
 * 503 Service Unavailable - External service error
 */
export class ServiceError extends AppError {
  constructor(code: string, message?: string) {
    super(code, 503, message);
    this.name = "ServiceError";
  }
}
