import { useCallback, useEffect, useRef, useState } from 'react';

/*  Web Push registration hook — plugs into any React host product.
 *
 *  <usePushNotifications
 *    apiBaseUrl="https://notify.example.com/api/v1"
 *    userId={user.id}
 *    tenantId={tenant.id}
 *    authHeader={{ 'X-API-Key': '...' }}   // or Authorization: Bearer <jwt>
 *  />
 *
 *  Registers /sw.js, creates the Push API subscription and links it to
 *  (userId, tenantId) via POST /devices/register.
 */

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

const isSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function usePushNotifications({
  apiBaseUrl,
  userId,
  tenantId,
  authHeader = {},
  swUrl = '/sw.js',
} = {}) {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('idle');
  const initRunRef = useRef(false);

  const headers = { 'Content-Type': 'application/json', ...authHeader };

  const registerServiceWorker = useCallback(async () => {
    const reg = await navigator.serviceWorker.register(swUrl, { scope: '/' });
    await navigator.serviceWorker.ready;
    return reg;
  }, [swUrl]);

  const sendSubscriptionToBackend = useCallback(
    async (subscription) => {
      const res = await fetch(`${apiBaseUrl}/devices/register`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tenant_id: tenantId,
          user_id: userId,
          platform: 'web',
          subscription: subscription.toJSON(),
          device_id: navigator.userAgent,
        }),
      });
      if (!res.ok) throw new Error(`register failed (${res.status})`);
      return res.json();
    },
    [apiBaseUrl, headers, tenantId, userId] // headers rebuilt each render; fine for this use
  );

  const subscribeToPush = useCallback(async () => {
    setStatus('subscribing');
    setError(null);
    try {
      const keyRes = await fetch(`${apiBaseUrl}/push/vapid-key`);
      const keyJson = await keyRes.json();
      const vapidKey = keyJson?.data?.publicKey;
      if (!vapidKey) throw new Error('VAPID public key not available on server');

      const reg = await registerServiceWorker();
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
      }
      await sendSubscriptionToBackend(sub);
      setIsSubscribed(true);
      setStatus('subscribed');
      return sub;
    } catch (err) {
      setError(err.message);
      setStatus('error');
      throw err;
    }
  }, [apiBaseUrl, registerServiceWorker, sendSubscriptionToBackend]);

  const requestPermission = useCallback(async () => {
    if (!isSupported()) {
      setError('Push notifications are not supported in this browser');
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') await subscribeToPush();
  }, [subscribeToPush]);

  const unsubscribe = useCallback(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    const json = sub.toJSON();
    await sub.unsubscribe();
    await fetch(`${apiBaseUrl}/devices/unregister`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tenant_id: tenantId, user_id: userId, endpoint: json.endpoint }),
    }).catch(() => {});
    setIsSubscribed(false);
    setStatus('idle');
  }, [apiBaseUrl, headers, tenantId, userId]);

  useEffect(() => {
    if (!isSupported() || !userId || !tenantId || initRunRef.current) return;
    initRunRef.current = true;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (sub && Notification.permission === 'granted') {
          await sendSubscriptionToBackend(sub);
          setIsSubscribed(true);
          setStatus('subscribed');
        }
      } catch {
        /* silent — user can tap the banner to retry */
      }
    })();
  }, [userId, tenantId, sendSubscriptionToBackend]);

  return {
    permission,
    isSubscribed,
    isSupported: isSupported(),
    error,
    status,
    requestPermission,
    subscribeToPush,
    unsubscribe,
  };
}

export default usePushNotifications;
