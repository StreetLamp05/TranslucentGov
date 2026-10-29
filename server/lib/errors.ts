// An error whose message the caller may see (§1.1.1), as M0's user-facing errors were.
// server/http.ts sends it as `{ error: message }` with `status`; any other throw becomes a bare
// 500, so a stray database or SDK message never reaches the browser. No imports, so either
// backend can use it.
export class UserError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "UserError";
    this.status = status;
  }
}
