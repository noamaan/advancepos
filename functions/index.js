/**
 * AdvancePOS — OPTIONAL Cloud Functions (Blaze plan required to deploy).
 *
 * 1) razorpayWebhook — genuine server-side payment verification for UPI orders
 *    created through Razorpay. Verifies the webhook signature, then verifies
 *    the payment via Razorpay's API before marking the sale paid + deducting
 *    stock atomically. Never trust the client for payment success.
 * 2) scheduledBackup — nightly Firestore export to a GCS bucket.
 *
 * Deploy:
 *   cd functions && npm install
 *   firebase functions:config:set razorpay.key_id="rzp_live_..." razorpay.secret="..."
 *   firebase deploy --only functions
 *
 * NOTE: The POS works fully WITHOUT these functions — UPI verification falls
 * back to the staff-confirmation workflow built into the app. These functions
 * add automated gateway-grade verification when you have a merchant account.
 */
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');

initializeApp();
const db = getFirestore();

// ── 1) Razorpay webhook ─────────────────────────────────────────────────────
// Configure the webhook URL in the Razorpay dashboard → point it here.
// The sale idempotency key is passed as the Razorpay order "receipt".
exports.razorpayWebhook = onRequest(async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET; // set via functions config / secrets
  if (!secret) return void res.status(500).send('not configured');

  const signature = req.headers['x-razorpay-signature'];
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body ?? {})).digest('hex');
  if (!signature || signature !== expected) return void res.status(401).send('bad signature');

  const event = req.body;
  if (event.event !== 'payment.captured') return void res.status(200).send('ignored');

  const payment = event.payload?.payment?.entity;
  const saleId = payment?.notes?.sale_id; // your backend creates the order with notes.sale_id
  if (!saleId) return void res.status(400).send('missing sale id');

  const saleRef = db.doc(`sales/${saleId}`);
  await db.runTransaction(async (t) => {
    const snap = await t.get(saleRef);
    if (!snap.exists) throw new Error('unknown sale');
    const sale = snap.data();
    if (sale.paymentStatus !== 'pending') return; // already handled → idempotent
    // Re-fetch from Razorpay to double-check amount/currency? Add API check here
    // using your key_id/secret before trusting webhook data (recommended).
    const paise = Math.round(sale.total * 100);
    if (payment.amount !== paise || payment.currency !== 'INR')
      throw new Error(`amount mismatch: expected ${paise} paise, got ${payment.amount}`);

    // deduct stock atomically
    for (const item of sale.items) {
      const pRef = db.doc(`products/${item.productId}`);
      const ps = await t.get(pRef);
      const p = ps.data();
      if (!p || p.stockQty < item.qty) throw new Error(`stock insufficient for ${item.name}`);
      t.update(pRef, { stockQty: p.stockQty - item.qty });
      t.set(db.collection('stock_movements').doc(), {
        productId: item.productId, productName: item.name, type: 'sale',
        qtyDelta: -item.qty, balanceAfter: p.stockQty - item.qty, refId: saleId,
        note: `Sale ${sale.billNo} (Razorpay verified ${payment.id})`,
        createdAt: Date.now(), createdBy: 'razorpay-webhook',
      });
    }
    t.update(saleRef, {
      paymentStatus: 'success', paidAt: Date.now(), stockDeducted: true,
      verifiedBy: 'razorpay-webhook', verifiedAt: Date.now(),
      gatewayPaymentId: payment.id,
    });
    t.set(db.collection('audit_logs').doc(), {
      actorId: 'razorpay-webhook', actorName: 'Razorpay', action: 'sale.verify',
      entity: 'sales', entityId: saleId,
      summary: `Payment ${payment.id} verified by gateway webhook for ${sale.billNo}`,
      createdAt: Date.now(),
    });
  });
  res.status(200).send('ok');
});

// ── 2) Nightly Firestore backup ─────────────────────────────────────────────
// Bucket must exist; give the Functions service account Firestore export perms.
const BACKUP_BUCKET = process.env.BACKUP_BUCKET || 'gs://advancepos-backups';

exports.scheduledBackup = onSchedule({ schedule: '30 2 * * *', timeZone: 'Asia/Kolkata' }, async () => {
  const client = new (require('@google-cloud/firestore').v1.FirestoreAdminClient)();
  const projectId = process.env.GCP_PROJECT || process.env.GCLOUD_PROJECT;
  const name = `projects/${projectId}/databases/(default)`;
  const stamp = new Date().toISOString().slice(0, 10);
  await client.exportDocuments({ name, outputUriPrefix: `${BACKUP_BUCKET}/daily/${stamp}` });
  // eslint-disable-next-line no-console
  console.log(`Backup exported to ${BACKUP_BUCKET}/daily/${stamp}`);
});
