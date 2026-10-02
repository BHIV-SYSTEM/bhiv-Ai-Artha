import Notification from '../models/Notification.js';
import DeviceToken from '../models/DeviceToken.js';
import logger from '../config/logger.js';

class PushNotificationService {
  constructor() {
    this.webPushAvailable = false;
    this.webPush = null;
    this._initPromise = this.init();
  }

  async init() {
    try {
      const webPush = await import('web-push');
      this.webPush = webPush.default;
      this._configureVapid();
    } catch {
      logger.info('Push notifications: web-push not installed, notifications stored but not pushed');
    }
  }

  _configureVapid() {
    if (!this.webPush) return;
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      this.webPush.setVapidDetails(
        'mailto:admin@artha.blackholeinfiverse.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
      );
      this.webPushAvailable = true;
      logger.info('Push notifications: VAPID keys configured');
    } else {
      logger.info('Push notifications: VAPID keys not set, push disabled (notifications still stored)');
    }
  }

  /** Call after dotenv.config() to re-check VAPID keys. Waits for web-push to load if needed. */
  async reconfigure() {
    await this._initPromise;
    this._configureVapid();
  }

  async sendNotification(data) {
    const notification = await Notification.create({
      title: data.title,
      body: data.body,
      type: data.type || 'info',
      category: data.category || 'system',
      recipientId: data.recipientId || null,
      recipientRole: data.recipientRole || 'all',
      data: data.data || {},
      priority: data.priority || 'normal',
      link: data.link || null,
      expiresAt: data.expiresAt || null,
    });

    if (this.webPushAvailable) {
      try {
        await this.pushToAllSubscribers(notification);
        notification.isPushed = true;
        notification.pushedAt = new Date();
        await notification.save();
      } catch (err) {
        notification.pushError = err.message;
        await notification.save();
        logger.warn(`Push broadcast failed: ${err.message}`);
      }
    }

    return notification;
  }

  async pushToAllSubscribers(notification) {
    if (!this.webPushAvailable) {
      logger.warn('pushToAllSubscribers: webPush not available, skipping');
      return { sent: 0, failed: 0, deactivated: 0 };
    }

    const devices = await DeviceToken.find({ isActive: true, platform: 'web' });
    logger.info(`pushToAllSubscribers: found ${devices.length} active web subscriptions for "${notification.title}"`);
    if (devices.length === 0) return { sent: 0, failed: 0, deactivated: 0 };

    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      type: notification.type,
      category: notification.category,
      priority: notification.priority,
      link: notification.link,
      data: notification.data,
      tag: `${notification.type}-${Date.now()}`,
      notificationId: notification._id,
    });

    let sent = 0;
    let failed = 0;
    let deactivated = 0;

    await Promise.allSettled(
      devices.map(async (device) => {
        try {
          const subscription = JSON.parse(device.token);
          await this.webPush.sendNotification(subscription, payload);
          device.lastUsedAt = new Date();
          await device.save();
          sent++;
        } catch (err) {
          if (err.statusCode === 410) {
            device.isActive = false;
            await device.save();
            deactivated++;
          } else {
            failed++;
            logger.warn(`Push to device failed: ${err.message}`);
          }
        }
      })
    );

    logger.info(`Push broadcast: ${sent} sent, ${failed} failed, ${deactivated} deactivated`);
    return { sent, failed, deactivated };
  }

  async pushToDevice(agentId, notification) {
    const tokens = await DeviceToken.find({ agentId, isActive: true });
    if (tokens.length === 0) return;

    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      type: notification.type,
      category: notification.category,
      data: notification.data,
      notificationId: notification._id,
    });

    const results = [];
    for (const device of tokens) {
      try {
        if (device.platform === 'web') {
          await this.webPush.sendNotification(
            JSON.parse(device.token),
            payload
          );
          results.push({ deviceId: device._id, success: true });
          device.lastUsedAt = new Date();
          await device.save();
        }
      } catch (err) {
        if (err.statusCode === 410) {
          device.isActive = false;
          await device.save();
        }
        results.push({ deviceId: device._id, success: false, error: err.message });
      }
    }

    return results;
  }

  async sendBulkNotification(data, recipientIds) {
    const results = [];
    for (const recipientId of recipientIds) {
      try {
        const notif = await this.sendNotification({ ...data, recipientId });
        results.push({ recipientId, success: true, id: notif._id });
      } catch (err) {
        results.push({ recipientId, success: false, error: err.message });
      }
    }
    return results;
  }

  async sendPaymentNotification(agentId, dealerName, amount, type) {
    return this.sendNotification({
      title: `${type === 'received' ? 'Payment received' : 'Payment pending'}: ${dealerName}`,
      body: `Amount: ₹${amount.toLocaleString('en-IN')}`,
      type: 'payment',
      category: 'finance',
      recipientId: agentId,
      data: { dealerName, amount, type },
      priority: 'high',
    });
  }

  async sendOverdueAlert(agentId, dealerName, overdueDays, amount) {
    return this.sendNotification({
      title: `Overdue: ${dealerName}`,
      body: `${overdueDays} days overdue - ₹${amount.toLocaleString('en-IN')}`,
      type: 'overdue',
      category: 'finance',
      recipientId: agentId,
      data: { dealerName, overdueDays, amount },
      priority: 'urgent',
    });
  }

  async getNotifications({ page = 1, limit = 20, unreadOnly = false, type, category } = {}) {
    const query = {};
    if (unreadOnly) query.isRead = false;
    if (type) query.type = type;
    if (category) query.category = category;

    const total = await Notification.countDocuments(query);
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return {
      notifications,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async markRead(notificationId) {
    return Notification.findOneAndUpdate(
      { _id: notificationId },
      { isRead: true, readAt: new Date() },
      { new: true }
    );
  }

  async markAllRead() {
    return Notification.updateMany(
      { isRead: false },
      { isRead: true, readAt: new Date() }
    );
  }

  async getUnreadCount() {
    return Notification.countDocuments({ isRead: false });
  }

  async registerDeviceToken(agentId, agentName, token, platform, deviceId) {
    return DeviceToken.findOneAndUpdate(
      { token },
      { agentId, agentName, platform, deviceId, isActive: true, lastUsedAt: new Date() },
      { upsert: true, new: true }
    );
  }

  async removeDeviceToken(token) {
    return DeviceToken.findOneAndUpdate({ token }, { isActive: false });
  }

  async registerWebPushSubscription(subscription, userAgent) {
    const token = JSON.stringify(subscription);
    return DeviceToken.findOneAndUpdate(
      { token },
      {
        agentId: null,
        agentName: 'web-user',
        platform: 'web',
        deviceId: userAgent || 'unknown',
        isActive: true,
        lastUsedAt: new Date(),
      },
      { upsert: true, new: true }
    );
  }
}

export default new PushNotificationService();
