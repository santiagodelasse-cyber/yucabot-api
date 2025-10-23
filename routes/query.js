const express = require("express");

const router = express.Router();

router.post("/", async (req, res) => {
  res.status(501).json({ error: "Query endpoint not implemented yet" });
});

module.exports = router;
