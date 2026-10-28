// Server-only test integration. Live keys are deliberately unsupported.
export class CheckrError extends Error {
 constructor(status,code){super('Checkr request failed');this.status=status;this.code=code;}
}
export class CheckrTenant {
 constructor({key=process.env.CHECKR_TEST_API_KEY,fetcher=fetch}={}){
  if(!key?.startsWith('ckr_sk_test_'))throw Error('A rotated Checkr test key is required');
  this.key=key;this.fetcher=fetcher;
 }
 async request(path,{method='GET',body,idempotencyKey}={}){
  if(!/^\/orders(?:\/[A-Za-z0-9_]+(?:\/report)?)?(?:\?per_page=1)?$/.test(path))throw Error('Invalid Checkr path');
  const r=await this.fetcher('https://tenant.checkr.com/api'+path,{method,headers:{Authorization:'Bearer '+this.key,'Content-Type':'application/json','Checkr-Tenant-Version':'2026-04-29',...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(65000)});
  // Never log upstream bodies: they can contain consumer report information.
  const data=await r.json();if(!r.ok)throw new CheckrError(r.status,data.errors?.[0]?.code||'request_error');
  if(data.live_mode===true)throw Error('Unexpected live-mode response');return data;
 }
 async create({property,applicant,original_requester,idempotencyKey,packageName='essential'}){
  if(!idempotencyKey||!['starter','essential','complete'].includes(packageName))throw Error('Invalid order');
  // Production identity information belongs in Checkr's hosted consent flow.
  const identity={first_name:applicant.first_name,last_name:applicant.last_name,email:applicant.email};
  return this.request('/orders',{method:'POST',idempotencyKey,body:{order:{package:packageName,property,applicant:identity,payer:'organization',...(original_requester?{original_requester}:{})}}});
 }
 async status(id){if(!/^ord_test_[A-Za-z0-9_-]+$/.test(id))throw Error('Test order required');return this.request('/orders/'+id);}
 async report(id){if(!/^ord_test_[A-Za-z0-9_-]+$/.test(id))throw Error('Test order required');try{return await this.request('/orders/'+id+'/report');}catch(e){if(e.status===404)return null;throw e;}}
}
export function reportSummary(report){const products=['criminal_history','credit_report','eviction_history','identity_verification','income_verification','sex_offender_registry','global_watchlist'];return {report_id:report.id,product_statuses:Object.fromEntries(products.map(k=>[k,report[k]?.status??null]))};}
