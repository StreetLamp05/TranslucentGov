import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { checkPostMedia as checkMedia } from "../../server/lib/postMedia";
import { UserError } from "../../server/lib/errors";

// The post-media checks (server/lib/postMedia.ts) on Convex storage. Their messages reach the
// poster, so they're rethrown as ConvexError.
export async function checkPostMedia(
  ctx: MutationCtx,
  media: { mediaType: Doc<"reports">["mediaType"]; clipStorageId?: Id<"_storage">; frameStorageIds: Id<"_storage">[] },
) {
  try {
    await checkMedia((key) => ctx.db.system.get(key as Id<"_storage">), media);
  } catch (error) {
    if (error instanceof UserError) throw new ConvexError(error.message);
    throw error;
  }
}
