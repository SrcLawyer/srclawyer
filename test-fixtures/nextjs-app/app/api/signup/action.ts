"use server";

import { z } from "zod";
import { actionClient } from "@/lib/action-client";

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().optional(),
});

export const createUserAction = actionClient.inputSchema(SignupSchema).action(async ({ parsedInput }) => {
  return { ok: true, email: parsedInput.email };
});
