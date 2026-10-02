import mongoose from 'mongoose';

const locationPingSchema = new mongoose.Schema({
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SalesAgent',
    required: true,
    index: true,
  },
  agentName: {
    type: String,
    required: true,
  },
  latitude: {
    type: Number,
    required: true,
    min: -90,
    max: 90,
  },
  longitude: {
    type: Number,
    required: true,
    min: -180,
    max: 180,
  },
  accuracy: {
    type: Number,
    default: 0,
  },
  altitude: {
    type: Number,
    default: null,
  },
  speed: {
    type: Number,
    default: null,
  },
  heading: {
    type: Number,
    default: null,
  },
  batteryLevel: {
    type: Number,
    min: 0,
    max: 100,
    default: null,
  },
  batteryCharging: {
    type: Boolean,
    default: false,
  },
  networkType: {
    type: String,
    enum: ['wifi', 'cellular', '4g', '5g', 'offline', 'unknown'],
    default: 'unknown',
  },
  deviceId: {
    type: String,
    default: '',
  },
  devicePlatform: {
    type: String,
    enum: ['android', 'ios', 'web', 'unknown'],
    default: 'web',
  },
  address: {
    type: String,
    default: '',
  },
  nearbyDealer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Dealer',
    default: null,
  },
  isAtDealer: {
    type: Boolean,
    default: false,
  },
  visitId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Visit',
    default: null,
  },
  source: {
    type: String,
    enum: ['mobile', 'browser', 'manual', 'connector'],
    default: 'mobile',
  },
}, {
  timestamps: true,
});

locationPingSchema.index({ agentId: 1, createdAt: -1 });
locationPingSchema.index({ latitude: 1, longitude: 1 });
locationPingSchema.index({ nearbyDealer: 1 });
locationPingSchema.index({ createdAt: -1 });

locationPingSchema.set('toJSON', { virtuals: true });

export default mongoose.model('LocationPing', locationPingSchema);
