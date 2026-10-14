import { relative } from "node:path";
import { blob } from "@/server/data/blob";
import { UploadError, finalizeBlobUpload, ownedUpload } from "@/server/convert";
import { usesBlob } from "@/server/data/io";
import { dataDir } from "@/server/paths";
import { designPath, sweep } from "@/server/store";
import { noStore, notFound } from "@/server/views";

/** Reading the design and generating the first project run after the response, in this function. */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * The browser calls this when its direct-to-Blob upload has finished. Blob's own completion
 * webhook (onUploadCompleted) never reaches localhost or a deployment behind Vercel's
 * Deployment Protection, which left uploads stuck in "reading"; this doesn't depend on it.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/uploads/[id]/complete">) {
  if (!usesBlob()) return Response.json({ error: "Not a Blob deployment." }, { status: 400, headers: noStore });
  const { id } = await ctx.params;
  const rec = await ownedUpload(id);
  if (!rec) return notFound();
  if (rec.state !== "reading" || rec.size > 0) return Response.json({ id, state: rec.state }, { status: 202, headers: noStore });
  const { head } = await blob();
  const key = relative(dataDir, designPath(id)).split("\\").join("/");
  const meta = await head(key).catch(() => null);
  if (!meta) return Response.json({ error: "The uploaded file wasn't found. Try again." }, { status: 404, headers: noStore });
  try {
    await finalizeBlobUpload(rec, meta.size);
  } catch (e) {
    if (e instanceof UploadError) return Response.json({ error: e.message }, { status: e.status, headers: noStore });
    throw e;
  }
  await sweep().catch(() => undefined);
  return Response.json({ id, state: "reading" }, { status: 202, headers: noStore });
}
