import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {CheckrTenant,reportSummary} from '../lib/checkr-tenant.mjs';
import {testConfiguration,paymentForApplication,fulfillScreening,createCheckout,validateInvitation,TERMS_VERSION} from '../lib/screening.mjs';
import {verifyStripeEvent} from '../lib/stripe-listing.mjs';
function fixture(){const a={id:randomUUID(),amount_cents:7900,stripe_session_id:'cs_test_123',status:'checkout_created',applicant:{first_name:'Test',last_name:'Applicant',email:'test@example.com'},property:{street:'1 Test St',city:'Atlanta',state:'GA',zipcode:'30303'},checkr_idempotency_key:randomUUID()};const event={id:'evt_test',type:'checkout.session.completed',created:1800000000,livemode:false,data:{object:{id:a.stripe_session_id,livemode:false,mode:'payment',payment_status:'paid',currency:'usd',amount_total:7900,client_reference_id:a.id,metadata:{aplynx_service:'tenant_screening',terms_version:TERMS_VERSION}}}};return {a,event};}
test('production, live keys, missing flags and insecure origins fail closed',()=>{
 const env={VERCEL_ENV:'preview',SCREENING_TEST_ENABLED:'true',STRIPE_SCREENING_TEST_KEY:'rk_test_dummy',CHECKR_TEST_API_KEY:'ckr_sk_test_dummy',SCREENING_TEST_SITE_URL:'https://preview.example.com'};assert.equal(testConfiguration(env).origin,'https://preview.example.com');
 for(const change of [{VERCEL_ENV:'production'},{SCREENING_TEST_ENABLED:'false'},{STRIPE_SCREENING_TEST_KEY:'sk_live_dummy'},{CHECKR_TEST_API_KEY:'ckr_sk_live_dummy'},{SCREENING_TEST_SITE_URL:'http://preview.example.com'}])assert.throws(()=>testConfiguration({...env,...change}));
 assert.throws(()=>new CheckrTenant({key:'ckr_sk_live_dummy'}));
});
test('only a fully paid matching test checkout can fulfill an application',()=>{
 const {a,event}=fixture();assert.equal(paymentForApplication(event,a),true);
 for(const patch of [{payment_status:'unpaid'},{livemode:true},{amount_total:1},{currency:'eur'},{client_reference_id:randomUUID()},{id:'cs_test_other'}]){const e=structuredClone(event);Object.assign(e.data.object,patch);assert.equal(paymentForApplication(e,a),false);}
 for(const type of ['checkout.session.expired','checkout.session.async_payment_failed'])assert.equal(paymentForApplication({...event,type},a),false);
 assert.equal(paymentForApplication({...event,type:'checkout.session.async_payment_succeeded'},a),true);
 assert.equal(paymentForApplication({...event,livemode:true},a),false);
});
test('concurrent duplicate webhooks create exactly one order',async()=>{
 const {a,event}=fixture();let calls=0;const store={get:async()=>a,claim:async()=>{if(a.status!=='checkout_created')return false;a.status='ordering';return true;},update:async(id,b)=>Object.assign(a,b)};
 const client={create:async input=>{calls++;assert.equal(input.idempotencyKey,a.checkr_idempotency_key);return {id:'ord_test_123',live_mode:false,status:'completed'};}};
 await Promise.all([fulfillScreening(event,{store,client}),fulfillScreening(event,{store,client})]);assert.equal(calls,1);assert.equal(a.status,'completed');
});
test('ambiguous Checkr failure requires review and cannot automatically duplicate a test order',async()=>{
 const {a,event}=fixture();let calls=0;const store={get:async()=>a,claim:async()=>{if(a.status!=='checkout_created')return false;a.status='ordering';return true;},update:async(id,b)=>Object.assign(a,b)};const client={create:async()=>{calls++;throw Error('timeout');}};
 await assert.rejects(fulfillScreening(event,{store,client}));assert.equal(a.status,'needs_review');await fulfillScreening(event,{store,client});assert.equal(calls,1);
});
test('Checkr sends business-paid order, stable idempotency, and no sensitive identity fields',async()=>{
 let request;const c=new CheckrTenant({key:'ckr_sk_test_dummy',fetcher:async(url,options)=>{request={url,options};return Response.json({id:'ord_test_123',live_mode:false,status:'pending'},{status:201});}});
 await c.create({applicant:{first_name:'Test',last_name:'Applicant',email:'test@example.com',ssn:'do not send',dob:'do not send'},property:{street:'1 Test St'},idempotencyKey:'stable'});
 const b=JSON.parse(request.options.body);assert.equal(b.order.payer,'organization');assert.equal(b.order.package,'essential');assert.equal(b.order.applicant.ssn,undefined);assert.equal(b.order.applicant.dob,undefined);assert.equal(request.options.headers['Idempotency-Key'],'stable');
 await assert.rejects(c.status('ord_live_123'));
});
test('report not ready is tolerated and summaries exclude report contents',async()=>{
 const c=new CheckrTenant({key:'ckr_sk_test_dummy',fetcher:async()=>Response.json({errors:[{code:'not_found_error'}]},{status:404})});assert.equal(await c.report('ord_test_123'),null);
 const s=reportSummary({id:'rp_test_123',criminal_history:{status:'consider',records:['private']},ssn:'private'});assert.equal(s.product_statuses.criminal_history,'consider');assert.equal(JSON.stringify(s).includes('private'),false);
});
test('checkout fixes amount server-side and never uses applicant-pay Checkr link',async()=>{
 const {a}=fixture();let params;const s=await createCheckout(a,{key:'rk_test_dummy',origin:'https://preview.example.com',fetcher:async(url,o)=>{params=o.body;return Response.json({id:'cs_test_123',livemode:false,url:'https://checkout.stripe.com/c/pay/test'});}});
 assert.equal(params.get('line_items[0][price_data][unit_amount]'),'7900');assert.equal(params.has('payment_method_types'),false);assert.equal(s.stripe_session_id,'cs_test_123');
});
test('signed webhook rejects tampering, stale timestamps and accepts signature rotation',()=>{
 const raw=Buffer.from(JSON.stringify({id:'evt_test'})),secret='dummy',t=Math.floor(Date.now()/1000),sig=createHmac('sha256',secret).update(t+'.').update(raw).digest('hex');
 assert.equal(verifyStripeEvent(raw,`t=${t},v1=${'0'.repeat(64)},v1=${sig}`,secret).id,'evt_test');assert.throws(()=>verifyStripeEvent(Buffer.from('{}'),`t=${t},v1=${sig}`,secret));assert.throws(()=>verifyStripeEvent(raw,`t=${t},v1=${sig}`,secret,(t+301)*1000));
});
test('only staff-confirmed own-organization Georgia invitations are accepted',()=>{
 const b={applicant:{first_name:'Test',last_name:'Applicant',email:'test@example.com'},property:{street:'1 Test St',city:'Atlanta',state:'GA',zipcode:'30303'},availability_confirmed:true,fee_rules_reviewed:true,own_organization:true};assert.equal(validateInvitation(b).amount_cents,7900);assert.throws(()=>validateInvitation({...b,own_organization:false}));assert.throws(()=>validateInvitation({...b,availability_confirmed:false}));
});
