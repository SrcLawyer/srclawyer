const express = require("express");
const Stripe = require("stripe");

const stripe = new Stripe("sk_test_FAKEFAKEFAKEFAKEFAKEFAKE");
const app = express();
app.use(express.json());

app.post("/signup", (req, res) => {
  const { email, fullName, phone } = req.body;
  db.users.create({ email, fullName, phone });
  res.json({ ok: true });
});

app.post("/checkout", async (req, res) => {
  const cardNumber = req.body.cardNumber;
  const customer = await stripe.customers.create({ email: req.body.email });
  res.json({ customer });
});

app.listen(3000);
