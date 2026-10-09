import mongoose from 'mongoose';

const setuIngestEventSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
    },
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      enum: [
        'order.confirmed',
        'order.cancelled',
        'payment.received',
        'supplier.purchase-approved',
      ],
    },
    idempotencyKey: {
      type: String,
      index: true,
    },
    status: {
      type: String,
      enum: ['PROCESSED'],
      default: 'PROCESSED',
    },
    result: {
      type: mongoose.Schema.Types.Mixed,
    },
    traceId: {
      type: String,
    },
  },
  { timestamps: true, collection: 'setu_ingest_events' }
);

setuIngestEventSchema.index({ tenantId: 1, eventType: 1, idempotencyKey: 1 });

export default mongoose.model('SetuIngestEvent', setuIngestEventSchema);
