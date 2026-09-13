import mixpanel from "mixpanel-browser";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { email, zipCode } = req.body;
  mixpanel.track("newsletter_signup", { email });
  res.status(200).json({ subscribed: true, zipCode });
}
