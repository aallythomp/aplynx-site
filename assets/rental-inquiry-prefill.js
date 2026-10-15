const rental=new URLSearchParams(location.search).get('rental');
if(rental&&/^fmls-\d{7}$/.test(rental)){
 fetch('/data/partner-rentals.json').then(r=>{if(!r.ok)throw Error();return r.json()}).then(homes=>{
  const home=homes.find(x=>x.id===rental);if(!home)return;
  const form=document.getElementById('book-search-form');if(!form)return;
  form.closest('details')?.setAttribute('open','');
  const fields={'b-service':'Rental home search','b-area':home.city,'b-budget':'$'+home.monthly_rent+' / month','b-notes':'I am interested in '+home.address+', '+home.city+', GA '+home.postal_code+' (FMLS #'+home.mls_number+'). Please contact me about availability and a property tour.'};
  for(const [id,value] of Object.entries(fields)){const field=document.getElementById(id);if(field&&!field.value)field.value=value}
  form.scrollIntoView({block:'start'});
 }).catch(()=>{});
}
