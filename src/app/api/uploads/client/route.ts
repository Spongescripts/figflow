import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { timingSafeEqual } from "node:crypto";
import { relative } from "node:path";
import { ownerId } from "@/server/owner";
import { dataDir } from "@/server/paths";
import { designPath, getUpload, MAX_UPLOAD_BYTES } from "@/server/store";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Payload = { id: string; fileName: string; declared: number | null };

function pathnameForUpload(id: string): string {
  return relative(dataDir, designPath(id)).split("\\").join("/");
}

/** Hands the browser a token to upload its .fig straight to Blob (the file never passes through this function). */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const owner = await ownerId(true);
        let payload: Payload;
        try {
          payload = JSON.parse(clientPayload ?? "{}") as Payload;
        } catch {
          throw new Error("Invalid upload payload.");
        }
        const rec = payload.id ? await getUpload(payload.id) : null;
        if (!rec || rec.state !== "reading") throw new Error("Upload session expired. Try again.");
        const a = Buffer.from(rec.owner, "hex");
        const b = Buffer.from(owner, "hex");
        if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Not allowed.");
        if (pathname !== pathnameForUpload(rec.id)) throw new Error("Invalid upload path.");
        if (payload.declared !== null && payload.declared > MAX_UPLOAD_BYTES)
          throw new Error(`The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
        return {
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          allowedContentTypes: ["application/octet-stream", "application/x-fig", "application/zip"],
          addRandomSuffix: false,
          allowOverwrite: true,
          tokenPayload: JSON.stringify({ id: rec.id }),
        };
      },
      // The browser finalizes through /api/uploads/[id]/complete. This webhook never reaches
      // localhost or a deployment behind Deployment Protection, so nothing depends on it.
      onUploadCompleted: async () => {},
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
