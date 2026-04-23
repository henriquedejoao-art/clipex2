import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs-extra";
import { v4 as uuidv4 } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const OUTPUT_DIR = path.join(process.cwd(), "outputs");

// Ensure directories exist
fs.ensureDirSync(UPLOAD_DIR);
fs.ensureDirSync(OUTPUT_DIR);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*" },
  });

  app.use(express.json());
  app.use("/uploads", express.static(UPLOAD_DIR));
  app.use("/outputs", express.static(OUTPUT_DIR));

  // Multer setup
  const storage = multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${uuidv4()}${ext}`);
    },
  });
  const upload = multer({ storage });

  // API Routes
  app.post("/api/upload", upload.single("video"), (req: any, res) => {
    if (!req.file) return res.status(400).json({ error: "No video uploaded" });

    // Get video duration using ffprobe
    ffmpeg.ffprobe(req.file.path, (err, metadata) => {
      if (err) return res.status(500).json({ error: "Failed to probe video" });
      
      res.json({
        id: uuidv4(),
        name: req.file?.originalname,
        originalPath: `/uploads/${req.file?.filename}`,
        duration: metadata.format.duration || 0,
        createdAt: Date.now(),
        clips: [],
      });
    });
  });

  app.post("/api/process-clip", async (req, res) => {
    const { videoPath, startTime, duration, clipId, isVertical } = req.body;
    const inputPath = path.join(process.cwd(), videoPath.replace(/^\//, ""));
    const outputFileName = `clip-${clipId}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFileName);

    let command = ffmpeg(inputPath)
      .setStartTime(startTime)
      .setDuration(duration);

    if (isVertical) {
      // 9:16 crop: center crop from horizontal
      // Assuming 1920x1080 -> 608x1080 (9:16 approx or exact crop)
      // Complexity: we use vf "crop=in_h*9/16:in_h"
      command = command.videoFilters("crop=in_h*9/16:in_h");
    }

    command
      .on("start", () => {
        io.emit("progress", { clipId, percent: 0, message: "Starting clip processing..." });
      })
      .on("progress", (progress) => {
        io.emit("progress", { clipId, percent: progress.percent, message: "Editing video frames..." });
      })
      .on("error", (err) => {
        console.error("FFmpeg error:", err);
        io.emit("progress", { clipId, percent: 0, message: "Processing failed: " + err.message });
      })
      .on("end", () => {
        io.emit("progress", { clipId, percent: 100, message: "Clip ready!", outputPath: `/outputs/${outputFileName}` });
      })
      .save(outputPath);

    res.json({ status: "processing", clipId });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
