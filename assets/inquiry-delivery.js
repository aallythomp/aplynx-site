// Existing Web3Forms notification stays in the browser; private CRM keys stay on Vercel.
async function deliverWebsiteInquiry(form,payload,notification,signal) {
 const crm=fetch('/api/inquiry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal}).then(async r=>{const d=await r.json();if(!r.ok||!d.success)throw Error('CRM delivery failed');return d;});
 const mail=form.dataset.notifiedReference===payload.reference?Promise.resolve():fetch('https://api.web3forms.com/submit',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(notification),signal}).then(async r=>{const d=await r.json();if(!r.ok||d.success!==true)throw Error('Email notification failed');form.dataset.notifiedReference=payload.reference;});
 const results=await Promise.allSettled([crm,mail]);if(results.some(r=>r.status==='rejected'))throw Error('Inquiry delivery needs a retry');
 const r=await fetch('/api/inquiry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,action:'confirm_notification'}),signal});const d=await r.json();if(!r.ok||!d.success)throw Error('Inquiry verification needs a retry');return Response.json({success:true});
}
