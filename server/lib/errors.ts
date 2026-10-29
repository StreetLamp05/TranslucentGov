// An error whose message the caller may see, M1's ConvexError (§1.1.1). server/http.ts sends it
// as `{ error: message }` with `status`; any other throw becomes a bare 500, so a stray
// database or SDK message never reaches the browser. No imports, so convex/ can use it too.
export class UserError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "UserError";
    this.status = status;
  }
}
