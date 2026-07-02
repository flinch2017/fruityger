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
import { ensureEmailVerificationSchema } from "./utils/emailVerification.js";
import { backfillPostHashtags, ensureHashtagSchema } from "./utils/hashtags.js";
import { ensurePerformanceIndexes } from "./utils/performanceIndexes.js";
import { ensurePasskeySchema } from "./utils/webauthn.js";
import { ensurePostMediaThumbnailSchema } from "./utils/postMediaSchema.js";







dotenv.config();

const app = express();
const parsedPort = Number.parseInt(String(process.env.PORT || "5000"), 10);
const PORT = Number.isFinite(parsedPort) ? parsedPort : 5000;
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

const androidPasskeyFingerprints = String(
  process.env.ANDROID_PASSKEY_CERT_FINGERPRINTS ||
    [
      "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C",
      "2C:BF:76:84:32:77:5E:94:89:A3:FD:F8:DE:BB:2F:F5:5E:D8:A8:8A:9F:3E:8C:17:E3:CF:0B:06:53:B5:04:97",
    ].join(",")
)
  .split(",")
  .map((fingerprint) => fingerprint.trim())
  .filter(Boolean);

app.get("/.well-known/assetlinks.json", (req, res) => {
  res.type("application/json").send([
    {
      relation: [
        "delegate_permission/common.handle_all_urls",
        "delegate_permission/common.get_login_creds",
      ],
      target: {
        namespace: "android_app",
        package_name: "com.dossiercreatives.fruityger",
        sha256_cert_fingerprints: androidPasskeyFingerprints,
      },
    },
  ]);
});

app.get("/.well-known/apple-app-site-association", (req, res) => {
  const appleTeamId = String(process.env.APPLE_TEAM_ID || "").trim();

  res.type("application/json").send({
    webcredentials: {
      apps: appleTeamId ? [`${appleTeamId}.com.dossiercreatives.fruityger`] : [],
    },
  });
});

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
  .catch((err) => console.error("Email verification schema bootstrap failed:", err));

ensureHashtagSchema()
  .then(() => backfillPostHashtags())
  .catch((err) => {
    console.error("Hashtag bootstrap failed:", err);
  });

ensurePerformanceIndexes().catch((err) => {
  console.error("Performance index bootstrap failed:", err);
});

ensurePasskeySchema().catch((err) => {
  console.error("Passkey schema bootstrap failed:", err);
});

ensurePostMediaThumbnailSchema().catch((err) => {
  console.error("Post media thumbnail schema bootstrap failed:", err);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
