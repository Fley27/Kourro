export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = "error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (msg: string, code = "bad_request") => new HttpError(400, msg, code);
export const unauthorized = (msg = "Not authenticated.") => new HttpError(401, msg, "unauthorized");
export const forbidden = (msg = "You do not have permission to do that.") => new HttpError(403, msg, "forbidden");
export const notFound = (msg = "Not found.") => new HttpError(404, msg, "not_found");
export const conflict = (msg: string, code = "conflict") => new HttpError(409, msg, code);

export function requireFields(body: unknown, fields: string[]): Record<string, any> {
  if (!body || typeof body !== "object") throw badRequest("Request body is required.");
  const obj = body as Record<string, any>;
  for (const field of fields) {
    const value = obj[field];
    if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
      throw badRequest(`"${field}" is required.`, "missing_field");
    }
  }
  return obj;
}
