// Run only after saving a NEW test key locally; never paste keys into chat.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {CheckrTenant,reportSummary} from '../lib/checkr-tenant.mjs';
const client=new CheckrTenant();
try{
 await client.request('/orders?per_page=1');console.log('Checkr test authentication: passed');
 for(const packageName of ['complete','starter']){
  const order=await client.request('/orders',{method:'POST',idempotencyKey:randomUUID(),body:{order:{package:packageName,payer:'organization',property:{street:'1 Market St',city:'San Francisco',state:'CA',zipcode:'94105'},applicant:{first_name:'Herbert',last_name:'Humphrey',email:'herbert.humphrey@example.com',dob:'1996-04-27',ssn:'111-11-1111'}}}});
  assert.equal(order.live_mode,false);assert.match(order.id,/^ord_test_/);const until=Date.now()+120000;let report;
  while(Date.now()<until){const current=await client.status(order.id);if(current.status==='completed'){report=await client.report(order.id);if(report?.criminal_history?.status)break;}await new Promise(r=>setTimeout(r,3000));}
  assert.ok(report,'Test report did not finish within two minutes');assert.equal(report.criminal_history.status,'consider');
  if(packageName==='starter')for(const name of ['credit_report','eviction_history','income_verification','identity_verification'])assert.equal(report[name],null);
  console.log(JSON.stringify({package:packageName,order_id:order.id,...reportSummary(report),passed:true}));
 }
}catch(e){console.error(JSON.stringify({passed:false,status:e.status||null,code:e.code||'test_failed'}));process.exitCode=1;}
