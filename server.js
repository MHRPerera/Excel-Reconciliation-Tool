const express = require("express");
const path = require("path");
const apiRoutes = require("./routes/api");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use("/api", apiRoutes);
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Excel Comparison Tool running at http://localhost:${PORT}`);
  console.log(`Max upload size: ${process.env.MAX_FILE_MB || "5000"} MB (set MAX_FILE_MB to change)`);
});
