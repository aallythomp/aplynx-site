import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const sources = {
 "654 Ladora Drive":["https://movewithmomentum.com/listings/idx-gamls/654-ladora-drive-dallas","https://www.mackreynolds.com/homes-for-sale/654-Ladora-Drive-Dallas-GA-30157-437516761"],
 "70 S Beckman Court S":["https://www.mackreynolds.com/homes-for-sale/70-S-Beckman-Court-Dallas-GA-30132-434874027"],
 "434 Hunt Creek Drive":["https://hollidayrealtors.com/homes-for-sale/434-Hunt-Creek-Drive-Acworth-GA-30101-428489816"],
 "3801 Stonewall Drive":["https://movewithmomentum.com/listings/idx-gamls/3801-stonewall-drive-kennesaw"],
 "5012 Serenity Point Lane":["https://movewithmomentum.com/listings/idx-gamls/5012-serenity-point-lane-villa-rica","https://www.crye-leike.com/p/5012-Serenity-Point-Lane-Villa-Rica-GA-30180/dmgid_188888333"],
 "228 Stephens Mill Drive":["https://www.mackreynolds.com/homes-for-sale/228-Stephens-Mill-Drive-Dallas-GA-30157-432787826"],
 "6061 Ridge Way":["https://www.coldwellbankerhomes.com/ga/douglasville/6061-ridge-way/pid_71422395/"],
 "383 Robin Hood Drive":["https://movewithmomentum.com/listings/idx-gamls/383-robin-hood-drive-douglasville"],
 "51 Bridgemill Run":["https://movewithmomentum.com/listings/idx-gamls/51-bridgemill-run-douglasville"],
 "252 Bridge Place":["https://movewithmomentum.com/listings/idx-gamls/252-bridge-place-douglasville"]
};
function srcFromHTML(body,base,addr){
 const tags=body.match(/<meta\b[^>]*>/gi)||[];
 const c=[];
 for(const t of tags)if(/(?:og:image|twitter:image)/i.test(t)){
   const m=t.match(/content\s*=\s*["']([^"']+)["']/i);if(m)c.push(m[1]);
 }
 const imgs=body.match(/<img\b[^>]*>/gi)||[];
 for(const i of imgs){
   const alt=(i.match(/alt\s*=\s*["']([^"']+)["']/i)||[])[1]||'';
   if(alt.toLowerCase().includes(addr.toLowerCase().split(' ').slice(0,2).join(' '))||(/photo 1|front elevation|main photo/i.test(alt))){
     const src=(i.match(/(?:data-src|src)\s*=\s*["']([^"']+)["']/i)||[])[1];
     if(src)c.push(src);
   }
 }
 return [...new Set(c.map(v=>v.replace(/&amp;/g,'&')).map(v=>{try{return new URL(v,base).href}catch{return ''}}).filter(v=>/^https:\/\//.test(v)))].slice(0,7);
}
async function load(url){
 const t=AbortSignal.timeout(6500);
 return fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36','Accept-Language':'en-US,en;q=0.9'},signal:t});
}
const path='homes-for-sale.html';
let page=readFileSync(path,'utf8');
mkdirSync('assets/property-covers',{recursive:true});
let added=0;
const tasks=Object.entries(sources);
async function run([address,pages]){
 const slug=address.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
 const filename='assets/property-covers/'+slug+'.jpg';
 if(existsSync(filename))return {address,filename};
 for(const p of pages){
  try{
   const resp=await load(p);if(!resp.ok)continue;
   const text=await resp.text();
   if(!text.toLowerCase().includes(address.split(' ')[0].toLowerCase()))continue;
   const candidates=srcFromHTML(text,p,address);
   for(const u of candidates){
    try{
     const image=await load(u);if(!image.ok)continue;
     const type=image.headers.get('content-type')||'';
     if(!/image\/(jpeg|png|webp)/i.test(type))continue;
     const bytes=Buffer.from(await image.arrayBuffer());
     if(bytes.length<10000||bytes.length>5500000)continue;
     const ext=type.includes('png')?'png':type.includes('webp')?'webp':'jpg';
     const file=filename.replace(/\.jpg$/,'.'+ext);
     writeFileSync(file,bytes);
     return {address,filename:file};
    }catch{}
   }
  }catch{}
 }
 console.log('Cover unavailable:',address);return null;
}
const out=[];
for(let k=0;k<tasks.length;k+=4){
 const batch=await Promise.all(tasks.slice(k,k+4).map(run));
 out.push(...batch.filter(Boolean));
}
for(const item of out){
 const start=page.indexOf('<h2>'+item.address+'</h2>');
 if(start<0)continue;
 const end=page.indexOf('</article>',start);
 if(end<0)continue;
 let part=page.slice(start,end);
 if(!part.includes('photo-placeholder'))continue;
 const url='/'+item.filename;
 const escaped=item.address.replace(/"/g,'&quot;');
 part=part.replace(/<div class="photo-placeholder">[\s\S]*?<\/div>/,`<button type="button" class="photo-launch" data-fullimage="${url}" data-photoaddress="${escaped}"><img loading="lazy" alt="Property photograph: ${escaped}" src="${url}"><span class="photo-overlay">Click to enlarge</span></button>`);
 page=page.slice(0,start)+part+page.slice(end);added++;
}
writeFileSync(path,page);
console.log('Added cover photo cards:',added,'downloaded photo assets:',out.length);
