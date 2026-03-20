import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import mainRoutes from "./routes/mainRoutes.js"
import uploadRoutes from "./routes/upload.js";
import postRoutes from "./routes/postRoutes.js";
import profilePostsRoutes from "./routes/profilePosts.js";
import likeRoutes from "./routes/likes.js";
import commentRoutes from "./routes/comments.js";
import commentLikeRoutes from "./routes/commentLikes.js";
import searchRoutes from "./routes/search.js";
import followRoutes from "./routes/follow.js";







dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Auth routes
app.use("/api/auth", authRoutes);
app.use("/api/main", mainRoutes);
app.use("/api/main", uploadRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/profile", profilePostsRoutes);
app.use("/api/likes", likeRoutes);
app.use("/api/comments", commentRoutes);
app.use("/api/commentLikes", commentLikeRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/follow", followRoutes);




app.get("/", (req, res) => {
  res.send({ status: "Fruityger backend running" });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));