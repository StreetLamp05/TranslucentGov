// The identity headers lib/data/api.ts sends and server/http.ts reads (§3.1). No imports, so
// both sides share them without the server pulling in browser code or the reverse.
export const RESIDENT_TOKEN_HEADER = "x-resident-token";
export const FIXER_TOKEN_HEADER = "x-fixer-token";
export const ADMIN_SESSION_HEADER = "x-admin-session";
