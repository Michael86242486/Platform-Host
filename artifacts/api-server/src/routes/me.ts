import { Router, type IRouter } from "express";

import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/me", requireAuth, (req, res) => {
  const u = req.user!;
  res.json({
    id: u.id,
    clerkUserId: u.clerkUserId,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    imageUrl: u.imageUrl,
    createdAt: u.createdAt.toISOString(),
  });
});

export default router;
