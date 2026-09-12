import { getLecturerSession } from "@/server/auth";
import { handleModelOriginalSource } from "@/server/model-original-source-handler";

export const runtime = "nodejs";

// Fixed authored material, never a caller-selected filesystem path. This does
// not read/write a lecture or expose another owner's document.
export async function GET(request: Request) {
  return handleModelOriginalSource(request, getLecturerSession);
}
