import { join } from "node:path";
import { ownedProject } from "@/server/convert";
import { projectDir } from "@/server/store";
import { noStore, notFound, zipResponse } from "@/server/views";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/uploads/[id]/projects/[project]/zip">) {
  const { id, project } = await ctx.params;
  const found = await ownedProject(id, project);
  if (!found) return notFound();
  const { state, error, manifest } = found.project;
  if (state === "working") return Response.json({ error: "The project is still being generated. Try again in a moment." }, { status: 409, headers: noStore });
  if (state === "failed" || !manifest?.zip)
    return Response.json({ error: error ? `The conversion failed: ${error}` : "This project has no ZIP. Convert the frame again." }, { status: 409, headers: noStore });
  return zipResponse(join(projectDir(id, project), manifest.zip.name), manifest.zip.name);
}
