import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
}, { timestamps: false });

counterSchema.statics.buildId = function(name, filter = {}) {
  // Use a unique key combining name and filter hash
  const filterKeys = Object.keys(filter).sort().map(k => `${k}:${filter[k]}`).join('|');
  return filterKeys ? `${name}:${filterKeys}` : name;
};

/**
 * Atomically increment and return the next sequence.
 * `legacyFilter` seeds a new (e.g. workspace-scoped) counter from the value
 * of an older key so already-issued numbers are never re-issued.
 */
counterSchema.statics.getNextSequence = async function(name, filter = {}, legacyFilter = null) {
  const update = { $inc: { seq: 1 } };
  const options = { upsert: true, new: true, setDefaultsOnInsert: true };
  const counterId = this.buildId(name, filter);

  if (legacyFilter) {
    const legacyId = this.buildId(name, legacyFilter);
    if (legacyId !== counterId) {
      const legacy = await this.findById(legacyId).lean();
      if (legacy && typeof legacy.seq === 'number') {
        await this.updateOne(
          { _id: counterId },
          { $setOnInsert: { seq: legacy.seq } },
          { upsert: true }
        );
      }
    }
  }

  const counter = await this.findOneAndUpdate({ _id: counterId }, update, options);
  return counter.seq;
};

export default mongoose.model('Counter', counterSchema);
