import mongoose from 'mongoose';
import logger from './logger.js';

// Global flag to track transaction availability
let transactionsAvailable = false;
let listenersBound = false;
let retryTimer = null;

const bindConnectionListeners = () => {
  if (listenersBound) return;
  listenersBound = true;

  mongoose.connection.on('disconnected', () => {
    transactionsAvailable = false;
    logger.warn('MongoDB disconnected - transactions disabled');
  });

  mongoose.connection.on('connected', async () => {
    try {
      await mongoose.connection.db.admin().command({ replSetGetStatus: 1 });
      transactionsAvailable = true;
      logger.info('MongoDB reconnected - transactions enabled');
    } catch {
      transactionsAvailable = false;
      logger.warn('MongoDB reconnected - transactions disabled (no replica set)');
    }
  });
};

const checkReplicaSet = async () => {
  try {
    await mongoose.connection.db.admin().command({ replSetGetStatus: 1 });
    transactionsAvailable = true;
    logger.info('Replica set detected - transactions enabled');
  } catch (error) {
    transactionsAvailable = false;
    logger.warn('Not running as replica set - transactions disabled');
    if (process.env.NODE_ENV === 'production') {
      logger.error('Production environment requires MongoDB replica set for transactions');
      logger.error('Please configure MongoDB as a replica set or use MongoDB Atlas');
    }
  }
};

const scheduleRetry = (attempt, message) => {
  const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
  logger.error(`Database connection failed (attempt ${attempt}): ${message}. Retrying in ${Math.round(delay / 1000)}s...`);
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connectDB(attempt + 1);
  }, delay);
  if (retryTimer.unref) retryTimer.unref();
};

const connectDB = async (attempt = 1) => {
  const mongoURI = process.env.NODE_ENV === 'test'
    ? process.env.MONGODB_TEST_URI
    : process.env.MONGODB_URI;

  try {
    const options = {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    };

    await mongoose.connect(mongoURI, options);

    logger.info(`MongoDB Connected: ${mongoose.connection.host}`);
    bindConnectionListeners();
    await checkReplicaSet();
  } catch (error) {
    // Never exit: a transient DNS/network failure to Atlas must not kill the
    // server (that produced crash/restart loops). Keep retrying with backoff.
    scheduleRetry(attempt, error.message);
  }
};

// Helper function to check transaction availability
export const areTransactionsAvailable = () => transactionsAvailable;

// Safe transaction wrapper
export const withTransaction = async (callback) => {
  if (!transactionsAvailable) {
    logger.warn('Transactions not available - executing without transaction');
    return await callback(null);
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await callback(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

export default connectDB;
