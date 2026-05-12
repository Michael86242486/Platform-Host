import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { requireAuth } from "../middlewares/auth";
import { db, usersTable } from "../lib/db";

const router: IRouter = Router();

router.get("/me", requireAuth, (req, res) => {
  const u = req.user!;
  res.json({
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    profileImageUrl: u.profileImageUrl,
    createdAt: new Date().toISOString(),
  });
});

const updateMeSchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  profileImageUrl: z.string().url().optional().nullable(),
});

router.patch("/me", requireAuth, async (req, res) => {
  const parsed = updateMeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }

  const { firstName, lastName, profileImageUrl } = parsed.data;
  const setValues: Partial<{
    firstName: string;
    lastName: string;
    profileImageUrl: string | null;
    updatedAt: Date;
  }> = { updatedAt: new Date() };

  if (firstName !== undefined) setValues.firstName = firstName;
  if (lastName !== undefined) setValues.lastName = lastName;
  if (profileImageUrl !== undefined) setValues.profileImageUrl = profileImageUrl;

  try {
    await db.update(usersTable).set(setValues).where(eq(usersTable.id, req.user!.id));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "update_failed" });
  }
});

export default router;
