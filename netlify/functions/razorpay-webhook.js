// Razorpay calls THIS function automatically whenever a payment happens
// (success, renewal, cancellation, etc). We verify the signature so we
// know it's really Razorpay talking to us, then update the user's
// membership status in Firestore. This is what makes the unlock automatic.
const crypto = require('crypto');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
  );
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const signature = event.headers['x-razorpay-signature'];
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(event.body)
    .digest('hex');

  if (signature !== expected) {
    return { statusCode: 400, body: 'Invalid signature' };
  }

  const payload = JSON.parse(event.body);
  const eventType = payload.event;
  const sub = payload.payload && payload.payload.subscription && payload.payload.subscription.entity;
  if (!sub) return { statusCode: 200, body: 'ignored' };

  const uid = sub.notes && sub.notes.uid;
  if (!uid) return { statusCode: 200, body: 'no uid in notes' };

  const db = admin.firestore();
  const ref = db.collection('users').doc(uid);

  if (eventType === 'subscription.charged' || eventType === 'subscription.activated') {
    await ref.set({
      membership: {
        active: true,
        subscriptionId: sub.id,
        currentEnd: sub.current_end * 1000,
        plan: sub.plan_id,
        updatedAt: Date.now()
      }
    }, { merge: true });
  } else if (
    eventType === 'subscription.cancelled' ||
    eventType === 'subscription.halted' ||
    eventType === 'subscription.completed'
  ) {
    await ref.set({
      membership: {
        active: false,
        subscriptionId: sub.id,
        updatedAt: Date.now()
      }
    }, { merge: true });
  }

  return { statusCode: 200, body: 'ok' };
};
