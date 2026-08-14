require("dotenv").config();
const express = require("express");
const path = require("path");

const seedAdminIfNeeded = require("./config/seedAdmin");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const electionRoutes = require("./routes/electionRoutes");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Student registration / OTP verification / login
app.use("/api/auth", authRoutes);

// Admin login + election management
app.use("/api/admin", adminRoutes);

// Elections overview, ballots, results, voting
app.use("/api", electionRoutes);

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, async () => {
  await seedAdminIfNeeded();
  console.log(`Voting system running at http://localhost:${PORT}`);
});
