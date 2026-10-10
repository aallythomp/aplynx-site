// Vercel server-only bridge. Never import this module into browser code.
const ORIGINS=new Set(['https://www.aplynxinvestments.com','https://aplynxinvestments.com']);
const limits=new Map();
export function makeLead(b){
 if(!b||typeof b!=='object'||!Array.isArray(b.lines)||b.lines.length>60)throw Error('Invalid inquiry');
 const fields={};for(const line of b.lines){if(!Array.isArray(line)||line.length!==2||typeof line[0]!=='string'||typeof line[1]!=='string'||line[0].length>100||line[1].length>5000)throw Error('Invalid fields');fields[line[0]]=line[1].trim();}
 const kind=b.form_kind;let type;
 if(kind==='search-form')type='apartment';else if(kind==='buyer-intake-form')type='buyer';else if(kind==='home-lead-form')type=fields.Interest==='Sell a home'?'seller':'buyer';else if(kind==='rental-form')type='room';else if(kind==='management-inquiry'||kind==='listing-form')type='management';else if(kind==='book-search-form')type=fields['Search type']==='Buy a home'?'buyer':'apartment';else throw Error('Unknown form');
 const reference=String(b.reference||'');if(!/^[A-Za-z0-9_-]{10,100}$/.test(reference))throw Error('Invalid reference');
 const email=String(fields.Email||'').toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!fields.Name||fields.Name.length>150)throw Error('Name and valid email are required');
 const requirements=b.lines.map(([k,v])=>`${k}: ${v}`).join('\n');if(requirements.length>12000)throw Error('Inquiry too large');
 const subject=({'search-form':'Apartment search service request','buyer-intake-form':'APLYNX buyer intake','home-lead-form':'APLYNX buyer or seller inquiry','rental-form':'1266 Fern Hill room application request','management-inquiry':'APLYNX property management inquiry','book-search-form':'APLYNX property search call request','listing-form':'APLYNX: Listing awaiting ADMIN APPROVAL'})[kind];
 if(!Number.isFinite(Date.parse(b.submitted_at)))throw Error('Invalid date');
 return {lead:{submission_id:reference,name:fields.Name,email,phone:fields.Phone||'',inquiry_type:type,submitted_at:b.submitted_at,requirements,area:fields.Areas||fields['Preferred areas']||fields['City or area']||fields['Search area']||fields['Property city']||'',budget:fields['Maximum monthly rent']||fields['Maximum purchase price']||fields.Budget||'',timeline:fields['Move timeframe']||fields['Desired move date']||fields.Timeline||fields['Purchase timeframe']||''},subject,kind};
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({success:false,error:'POST required'});
 if(!ORIGINS.has(req.headers.origin))return res.status(403).json({success:false,error:'Invalid origin'});
 const ip=String(req.headers['x-forwarded-for']||'unknown').split(',')[0];const now=Date.now();
 for(const [k,v] of limits)if(v.until<now)limits.delete(k);
 const quota=limits.get(ip)||{count:0,until:now+600000};if(++quota.count>15)return res.status(429).json({success:false,error:'Please wait before submitting again'});limits.set(ip,quota);
 let b,p;try{b=typeof req.body==='string'?JSON.parse(req.body):req.body;if(JSON.stringify(b).length>20000||b.botcheck)throw Error('Invalid inquiry');p=makeLead(b);}catch{return res.status(400).json({success:false,error:'Check your inquiry fields'});}
 const endpoint=process.env.CRM_LEAD_ENDPOINT,key=process.env.CRM_WEBSITE_LEAD_KEY,access=process.env.CRM_SITES_SERVICE_TOKEN,mailKey=process.env.WEB3FORMS_ACCESS_KEY;
 if(!endpoint||!key||!access||!mailKey)return res.status(503).json({success:false,error:'Inquiry service unavailable'});
 // Fixed, allowlisted destination prevents credentials from reaching another host.
 if(endpoint!=='https://aplynx-client-hub.hands-on-cha-3500.chatgpt.site/api/leads')return res.status(503).json({success:false,error:'Inquiry service unavailable'});
 const headers={'Content-Type':'application/json',Authorization:'Bearer '+key,'OAI-Sites-Authorization':'Bearer '+access};
 const post=async(payload)=>{const r=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(12000),redirect:'error'});const d=await r.json();if(!r.ok||!d.ok)throw Error('CRM delivery failed');return d;};
 let saved;try{saved=await post(p.lead);}catch{
 // Preserve the existing email notification even when CRM delivery is interrupted.
 try{await fetch('https://api.web3forms.com/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access_key:mailKey,subject:p.subject+' | '+p.lead.name+' | '+p.lead.submission_id,from_name:'APLYNX Investments',name:p.lead.name,email:p.lead.email,message:'CRM delivery needs review. Reference: '+p.lead.submission_id+'\n'+p.lead.requirements,botcheck:''}),signal:AbortSignal.timeout(8000)});}catch{}
 return res.status(503).json({success:false,error:'CRM delivery could not be confirmed. Keep your answers and retry.'});
 }
 try{
 if(!saved.email_notified){
 const message=typeof b.message==='string'&&b.message.length<=16000?b.message:p.lead.requirements;
 const r=await fetch('https://api.web3forms.com/submit',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({access_key:mailKey,subject:p.subject+' | '+p.lead.name+' | '+p.lead.submission_id,from_name:p.kind==='listing-form'?'APLYNX Property Submissions':'APLYNX Investments',name:p.lead.name,email:p.lead.email,message,botcheck:''}),signal:AbortSignal.timeout(10000)});
 const d=await r.json();if(!r.ok||d.success!==true)throw Error('Notification failed');await post({action:'notification_received',submission_id:p.lead.submission_id});
 }
 // Read back the actual saved inquiry before reporting the connection as verified.
 const check=await fetch(endpoint+'?submission_id='+encodeURIComponent(p.lead.submission_id),{headers,signal:AbortSignal.timeout(8000),redirect:'error'});const result=await check.json();
 if(!check.ok||result.inquiry?.client_id!==saved.client_id)throw Error('CRM readback failed');
 await post({action:'verify_connection',submission_id:p.lead.submission_id});
 return res.status(200).json({success:true,reference:p.lead.submission_id});
 }catch{return res.status(503).json({success:false,error:'Your inquiry is saved, but notification or verification needs a retry. Use the same reference.'});}
}
