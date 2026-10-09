import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import companyScope from '../utils/companyScope.js';

const ingestDocumentSchema = new mongoose.Schema(
  {
    documentId: {
      type: String,
      unique: true,
      default: () => `ING-${randomUUID()}`,
      immutable: true,
      index: true,
    },
    originalName: { type: String, required: true, trim: true },
    extension: { type: String, required: true, lowercase: true, index: true },
    category: {
      type: String,
      enum: ['pdf', 'image', 'document', 'spreadsheet', 'text'],
      required: true,
      index: true,
    },
    file: {
      filename: String,
      path: String,
      mimetype: String,
      size: Number,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      index: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'extracting', 'completed', 'partial', 'failed'],
      default: 'pending',
      index: true,
    },
    extraction: {
      method: String,
      pages: { type: Number, default: 0 },
      sections: { type: Number, default: 0 },
      charCount: { type: Number, default: 0 },
      ocrFallback: { type: Boolean, default: false },
      ocrConfidence: { type: Number, default: null },
      pdfInfo: { type: mongoose.Schema.Types.Mixed, default: {} },
      error: { type: String, default: null },
      errorMessage: { type: String, default: null },
      durationMs: { type: Number, default: 0 },
    },
    content: { type: String, default: '' },
    sectionList: [{ type: String }],
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

ingestDocumentSchema.index({ companyId: 1, createdAt: -1 });
ingestDocumentSchema.index({ companyId: 1, uploadedBy: 1, createdAt: -1 });

// Content can be large — only project it when explicitly requested.
ingestDocumentSchema.virtual('hasContent').get(function () {
  return Boolean(this.content && this.content.length > 0);
});

ingestDocumentSchema.plugin(companyScope);

export default mongoose.model('IngestDocument', ingestDocumentSchema);
