import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import mainRoutes from "./routes/mainRoutes.js"
import uploadRoutes from "./routes/upload.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Auth routes
app.use("/api/auth", authRoutes);
app.use("/api/main", mainRoutes);
app.use("/api/main", uploadRoutes);

app.get("/", (req, res) => {
  res.send({ status: "Fruityger backend running" });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));