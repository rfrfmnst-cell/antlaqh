import test from 'node:test';
import assert from 'node:assert/strict';
import { operationalDashboard } from '../lib/admin-dashboard.js';
test('admin operations distinguish unpaid commitments, responses and whole-day deadlines', () => {
  const order = (id, status, extra={}) => ({id,number:id,title:'طلب '+id,status,messages:[],contracts:[],...extra});
  const q = (date,accepted=true) => ({id:'q',deliveryDate:date,acceptedAt:accepted?'2026-10-01T10:00:00Z':null});
  const orders=[
    order('unpaid','awaiting_payment',{amount:10000}),
    order('confirmed','awaiting_payment',{amount:20000,payment:{confirmed:true,amount:20000}}),
    order('cancelled','cancelled',{amount:50000}),
    order('past','in_progress',{currentContract:'q',contracts:[q('2026-10-01')],messages:[{role:'customer',message:'private'}],trackingTokenHash:'private',password:'private'}),
    order('today','in_progress',{currentContract:'q',contracts:[q('2026-10-02')],messages:[{role:'customer'},{role:'admin'}]}),
    order('unsigned','quoted',{currentContract:'q',contracts:[q('2026-09-01',false)]}),
    order('done','completed',{currentContract:'q',contracts:[q('2026-09-01')]}),
  ];
  const d=operationalDashboard(orders,{clock:()=>Date.parse('2026-10-02T18:00:00+03:00')});
  assert.equal(d.overdue,1);assert.equal(d.awaitingTransfer,10000);assert.equal(d.awaitingReply,1);assert.equal(d.awaitingApproval,1);
  assert.equal(d.priorities.overdue[0].id,'past');assert.equal(d.stages.find(s=>s.status==='cancelled').count,1);
  assert.doesNotMatch(JSON.stringify(d),/private|trackingTokenHash|password/);
  const nextDay=operationalDashboard(orders,{clock:()=>Date.parse('2026-10-03T00:00:00+03:00')});assert.equal(nextDay.overdue,2);
});
test('empty operational dashboard reports real zero counts',()=>{const d=operationalDashboard([]);assert.equal(d.awaitingReply,0);assert.equal(d.awaitingTransfer,0);assert.equal(d.stages.reduce((n,s)=>n+s.count,0),0);});
