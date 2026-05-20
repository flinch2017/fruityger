import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import mobileRoutes from "./routes/mobile.js";
import mainRoutes from "./routes/mainRoutes.js"
import uploadRoutes from "./routes/upload.js";
import postRoutes from "./routes/postRoutes.js";
import profilePostsRoutes from "./routes/profilePosts.js";
import likeRoutes from "./routes/likes.js";
import commentRoutes from "./routes/comments.js";
import commentLikeRoutes from "./routes/commentLikes.js";
import searchRoutes from "./routes/search.js";
import followRoutes from "./routes/follow.js";
import reportRoutes from "./routes/report.js";
import messageRoutes from "./routes/messages.js";
import notificationRoutes from "./routes/notifications.js";
import repostRoutes from "./routes/reposts.js";
import adminRoutes from "./routes/admin.js";
import gameLobbyRoutes from "./routes/gameLobbies.js";
import { cleanupExpiredUnverifiedUsers, ensureEmailVerificationSchema } from "./utils/emailVerification.js";
import { backfillPostHashtags, ensureHashtagSchema } from "./utils/hashtags.js";
import { ensurePerformanceIndexes } from "./utils/performanceIndexes.js";







dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const allowedOrigins = String(
  process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || ""
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
  })
);
app.use(express.json());

// Auth routes
app.use("/api/auth", authRoutes);
app.use("/mobile", mobileRoutes);
app.use("/api/main", mainRoutes);
app.use("/api/main", uploadRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/profile", profilePostsRoutes);
app.use("/api/likes", likeRoutes);
app.use("/api/comments", commentRoutes);
app.use("/api/commentLikes", commentLikeRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/follow", followRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/reposts", repostRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/game-lobbies", gameLobbyRoutes);




app.get("/", (req, res) => {
  res.send({ status: "Fruityger backend running" });
});

ensureEmailVerificationSchema()
  .then(() => cleanupExpiredUnverifiedUsers())
  .catch((err) => console.error("Email verification bootstrap failed:", err));

ensureHashtagSchema()
  .then(() => backfillPostHashtags())
  .catch((err) => {
    console.error("Hashtag bootstrap failed:", err);
  });

ensurePerformanceIndexes().catch((err) => {
  console.error("Performance index bootstrap failed:", err);
});

setInterval(() => {
  cleanupExpiredUnverifiedUsers().catch((err) => {
    console.error("Email verification cleanup failed:", err);
  });
}, 60 * 60 * 1000);

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
