const results=document.getElementById('results');
const filters=['city','type','price','beds'].map(id=>document.getElementById(id));
let listings=JSON.parse(document.getElementById('partner-rentals').textContent);
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(n)||0);
const safeURL=value=>{if(!value)return null;try{const u=new URL(value,location.origin);return u.protocol==='https:'?u.href:null}catch{return null}};
function render(){
 const [city,type,price,beds]=filters.map(x=>x.value.trim());
 const shown=listings.filter(x=>(!city||[x.city,x.postal_code,x.address].some(v=>String(v||'').toLowerCase().includes(city.toLowerCase())))&&(!type||x.property_type===type)&&(!price||Number(x.monthly_rent)<=Number(price))&&(!beds||Number(x.bedrooms)>=Number(beds)));
 document.getElementById('result-count').textContent=shown.length+' '+(shown.length===1?'rental':'rentals')+' matching your search';
 results.className=shown.length?'cards':'empty';results.replaceChildren();
 if(!shown.length){results.textContent='No rentals match those filters. Try a different city or budget.';return}
 for(const x of shown){
  const card=document.createElement('article');card.className='listing';
  const photo=x.photos?.[0]||{url:x.photo_urls?.[0],alt:'Rental property in '+x.city};
  const photoURL=safeURL(photo.url);if(photoURL){const img=document.createElement('img');img.src=photoURL;img.alt=photo.alt;img.loading='lazy';card.append(img)}
  const body=document.createElement('div');body.className='card-body';card.append(body);
  const add=(tag,text,cls)=>{const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;body.append(el);return el};
  add('h2',x.address||x.property_type+' in '+x.city);add('p',x.city+', '+(x.state||'GA')+' '+(x.postal_code||''),'meta');
  add('p',money(x.monthly_rent)+' / month','price');add('p',x.bedrooms+' beds · '+x.bathrooms+' baths'+(x.square_feet?' · '+Number(x.square_feet).toLocaleString()+' sq ft':''));
  if(x.availability_note)add('p',x.availability_note,'note');
  if(x.listing_agent)add('p','Listed by '+x.listing_agent+' · '+x.listing_brokerage+' · FMLS #'+x.mls_number,'credit');
  else if(x.description)add('p',x.description.slice(0,220)+(x.description.length>220?'…':''));
  const href=safeURL(x.detail_url||x.application_url);if(href){const a=document.createElement('a');a.className='btn';a.href=href;a.textContent=x.detail_url?'Photos & full details':'View application';if(!x.detail_url){a.target='_blank';a.rel='noopener noreferrer'}body.append(a)}
  results.append(card);
 }
}
filters.forEach(el=>el.addEventListener('input',render));render();
fetch('/api/rentals').then(async r=>{if(!r.ok)throw Error('Unavailable');return r.json()}).then(d=>{
 const existing=Array.isArray(d.listings)?d.listings:[];
 const ids=new Set(listings.map(x=>x.id));const mls=new Set(listings.map(x=>x.mls_number).filter(Boolean));const addresses=new Set(listings.map(x=>(x.address+' '+x.city).toLowerCase().replace(/[^a-z0-9]/g,'')));
 listings=[...listings,...existing.filter(x=>!ids.has(x.id)&&(!x.mls_number||!mls.has(String(x.mls_number)))&&(!x.address||!addresses.has((x.address+' '+x.city).toLowerCase().replace(/[^a-z0-9]/g,''))))];render();
}).catch(()=>{document.getElementById('directory-note').textContent='Partner rentals are shown below. Additional owner-submitted listings could not be loaded. Call APLYNX for help: 833-393-1935.'});
