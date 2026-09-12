import { getLecturerSession, isValidLecturerCsrfRequest } from "@/server/auth";
import { ensureModelDemo } from "@/server/model-demo";
import { handleModelDemoPost } from "@/server/model-demo-handler";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleModelDemoPost(request, {
    getSession: getLecturerSession,
    isValidCsrf: isValidLecturerCsrfRequest,
    createDemo: (email) => ensureModelDemo(email)
  });
}
