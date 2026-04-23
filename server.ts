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

  app.use(express.json({ limit: '500mb' }));
  app.use(express.urlencoded({ extended: true, limit: '500mb' }));
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
  const upload = multer({ 
    storage,
    limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit
  });

  // API Routes
  app.post("/api/upload", upload.single("video"), (req: any, res) => {
    console.log("Upload request received");
    if (!req.file) {
      console.error("No file in request");
      return res.status(400).json({ error: "No video uploaded" });
    }

    console.log(`File uploaded to: ${req.file.path}`);

    // Get video duration using ffprobe
    ffmpeg.ffprobe(req.file.path, (err, metadata) => {
      if (err) {
        console.error("FFprobe error:", err);
        // Fallback for duration if ffprobe fails, so upload at least finishes
        return res.json({
          id: uuidv4(),
          name: req.file?.originalname,
          originalPath: `/uploads/${req.file?.filename}`,
          duration: 30, // Fallback duration
          createdAt: Date.now(),
          clips: [],
          warning: "FFprobe failed, using fallback duration"
        });
      }
      
      console.log("FFprobe metadata received");
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

    console.log(`Starting processing for clip ${clipId}: ${startTime}s for ${duration}s`);

    let command = ffmpeg(inputPath)
      .setStartTime(startTime)
      .setDuration(duration);

    if (isVertical) {
      // 9:16 crop: center crop from horizontal
      command = command.videoFilters("crop=in_h*9/16:in_h");
    }

    command
      .on("start", (commandLine) => {
        console.log("FFmpeg command:", commandLine);
        io.emit("progress", { clipId, percent: 0, message: "Initializing FFmpeg..." });
      })
      .on("progress", (progress) => {
        io.emit("progress", { clipId, percent: progress.percent, message: `Processing... ${Math.round(progress.percent || 0)}%` });
      })
      .on("error", (err) => {
        console.error("FFmpeg error:", err);
        io.emit("progress", { clipId, percent: 0, message: "Error: " + err.message });
      })
      .on("end", () => {
        console.log(`Finished processing clip ${clipId}`);
        io.emit("progress", { clipId, percent: 100, message: "Done!", outputPath: `/outputs/${outputFileName}` });
      })
      .overwriteOutput()
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
