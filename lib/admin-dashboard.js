export function operationalDashboard(orders, { clock = Date.now } = {}) {
  const active = orders.filter(o => !['completed','cancelled'].includes(o.status));
  const current = o => (o.contracts || []).find(q => q.id === o.currentContract);
  const awaitingReply = orders.filter(o => o.messages?.length && o.messages.at(-1).role !== 'admin');
  const outstanding = active.filter(o => o.status === 'awaiting_payment' && !(o.payment?.confirmed && !o.payment.revoked));
  const overdue = active.filter(o => {
    const q = current(o);
    if (!q?.acceptedAt || !['paid','in_progress','final_review'].includes(o.status)) return false;
    const due = Date.parse(q.deliveryDate);
    // A date-only commitment includes the whole agreed day in Riyadh.
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(q.deliveryDate || '') ? Date.parse(q.deliveryDate + 'T23:59:59+03:00') : due;
    return Number.isFinite(deadline) && deadline < clock();
  });
  const unsigned = active.filter(o => current(o) && !current(o).acceptedAt);
  const refs = list => list.slice(0,8).map(o => ({ id:o.id, number:o.number, title:o.title, status:o.status }));
  return {
    awaitingReply: awaitingReply.length, awaitingApproval:unsigned.length, overdue:overdue.length,
    awaitingTransfer: outstanding.reduce((n,o) => n + (Number.isSafeInteger(o.amount) && o.amount > 0 ? o.amount : 0),0),
    stages:['received','reviewing','quoted','awaiting_payment','paid','in_progress','final_review','completed','cancelled'].map(status => ({status,count:orders.filter(o => o.status === status).length})),
    priorities:{ replies:refs(awaitingReply), overdue:refs(overdue), approvals:refs(unsigned), payments:refs(outstanding) },
  };
}
