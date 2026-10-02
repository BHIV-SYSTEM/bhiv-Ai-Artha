import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false,
  },
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
  },
  phone: {
    type: String,
    trim: true,
    default: '',
  },
  department: {
    type: String,
    trim: true,
    default: '',
  },
  role: {
    type: String,
    enum: ['admin', 'sub_admin', 'accountant', 'viewer'],
    default: 'viewer',
  },
  // Client company this user belongs to. Null = personal workspace
  // (user sees only data they create themselves - starts from zero).
  // Super admins (role: 'admin') normally have no company.
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  lastLogin: Date,
  refreshToken: String,
  refreshTokenExpiresAt: Date,
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  activationCode: {
    type: String,
    select: false,
  },
  activatedAt: Date,
}, {
  timestamps: true,
});

userSchema.index({ role: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ companyId: 1 });
userSchema.index({ lastLogin: -1 });
userSchema.index({ resetPasswordExpire: 1 }, { expireAfterSeconds: 0 });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);

  if (this.isModified('refreshToken') && this.refreshToken && !this.refreshTokenExpiresAt) {
    this.refreshTokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }

  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model('User', userSchema);