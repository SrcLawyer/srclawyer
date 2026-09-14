import type { SignupRequest } from "../../../types/signup.js";

export async function POST(request: Request) {
  const body: SignupRequest = await request.json();
  return Response.json({ ok: true, email: body.email });
}
