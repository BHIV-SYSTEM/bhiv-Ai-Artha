import express from 'express';
import { protect } from '../middleware/auth.js';
import {
  ingestFile,
  listDocuments,
  getDocument,
  deleteDocument,
  getCapabilities,
} from '../controllers/ingest.controller.js';
import { ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES, MAX_FILE_SIZE } from '../services/documentExtractor.service.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const uploadDir = 'uploads/ingest';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const ext = path.extname(file.originalname);
    cb(null, `ingest-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeOk = !file.mimetype || ALLOWED_MIME_TYPES.includes(file.mimetype);

  if (ALLOWED_EXTENSIONS.includes(ext) && mimeOk) {
    cb(null, true);
    return;
  }
  cb(
    new Error(
      `Unsupported file type "${ext || file.mimetype}". Allowed types: ${ALLOWED_EXTENSIONS.join(', ')}`
    ),
    false
  );
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
});

const router = express.Router();

router.use(protect);

const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err) return res.status(400).json({ success: false, message: err.message });
  next();
};

router.post('/', upload.single('file'), handleUploadError, ingestFile);
router.get('/capabilities', getCapabilities);
router.get('/', listDocuments);
router.get('/:documentId', getDocument);
router.delete('/:documentId', deleteDocument);

export default router;
