// APLYNX listing cover photo resolver. Source URLs are fixed to verified address pages.
const sources={"654 Ladora Drive":["https://www.mackreynolds.com/homes-for-sale/654-Ladora-Drive-Dallas-GA-30157-437516761"],"9450 Pebble Creek Court":["https://www.georgiamls.com/9450-pebble-creek-court-villa-rica-ga-30180/10757184"],"70 S Beckman Court S":["https://www.mackreynolds.com/homes-for-sale/70-S-Beckman-Court-Dallas-GA-30132-434874027"],"1577 Fenmore Street":[],"434 Hunt Creek Drive":["https://hollidayrealtors.com/homes-for-sale/434-Hunt-Creek-Drive-Acworth-GA-30101-428489816"],"3801 Stonewall Drive":["https://movewithmomentum.com/listings/idx-gamls/3801-stonewall-drive-kennesaw"],"5012 Serenity Point Lane":["https://movewithmomentum.com/listings/idx-gamls/5012-serenity-point-lane-villa-rica"],"330 Peach Crossing Drive":["https://www.zillow.com/homedetails/330-Peach-Crossing-Dr-Dallas-GA-30132/237702190_zpid/"],"228 Stephens Mill Drive":["https://www.mackreynolds.com/homes-for-sale/228-Stephens-Mill-Drive-Dallas-GA-30157-432787826"],"4423 Turnberry Court":["https://www.coldwellbankerhomes.com/ga/douglasville/4423-turnberry-ct/pid_72300119/"],"6061 Ridge Way":["https://www.coldwellbankerhomes.com/ga/douglasville/6061-ridge-way/pid_71422395/"],"393 Robin Hood Drive":[],"51 Bridgemill Run":["https://movewithmomentum.com/listings/idx-gamls/51-bridgemill-run-douglasville"],"252 Bridge Place":["https://www.compass.com/homedetails/252-Bridge-Pl-Douglasville-GA-30134/PPAR2_pid/"],"76 Fontage":[]};
const decode=(s)=>s.replace(/&amp;/g,"&").replace(/&#39;/g,"'").replace(/&quot;/g,'"');
function imageCandidate(html){
  const tags=html.match(/<meta\b[^>]*>/gi)||[];
  for(const tag of tags){
    if(/(?:og:image|twitter:image)(?:\:secure_url)?/i.test(tag)){
      const m=tag.match(/content\s*=\s*["']([^"']+)["']/i);
      if(m&&/^https?:\/\//i.test(decode(m[1])))return decode(m[1]);
    }
  }
  const scripts=html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi)||[];
  for(const script of scripts){
    try{const data=JSON.parse(script.replace(/^.*?>/s,'').replace(/<\/script>$/i,''));
      const items=Array.isArray(data)?data:[data];
      for(const item of items){const im=item.image||item.photo;if(typeof im==='string'&&im.startsWith('http'))return im;if(Array.isArray(im)&&typeof im[0]==='string')return im[0];}
    }catch{}
  }
  return null;
}
export default async function handler(req,res){
  const address=String(req.query.address||"");
  const urls=sources[address];
  if(!urls){res.status(404).send("Unknown property");return}
  res.setHeader("Cache-Control","public, s-maxage=86400, stale-while-revalidate=604800");
  for(const url of urls){
    try{
      const page=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0 (compatible; APLYNXPropertyPreview/1.0)","Accept":"text/html"},signal:AbortSignal.timeout(6000)});
      if(!page.ok)continue;
      const html=(await page.text()).slice(0,700000);
      const short=address.replace(/ (Drive|Court|Street|Lane|Run|Place|Way)$/,'').split(' ').slice(0,2).join(' ').toLowerCase();
      if(!html.toLowerCase().includes(short))continue;
      const image=imageCandidate(html);
      if(!image)continue;
      const photo=await fetch(image,{headers:{"User-Agent":"Mozilla/5.0","Accept":"image/avif,image/webp,image/jpeg,image/png,*/*"},signal:AbortSignal.timeout(6500)});
      if(!photo.ok)continue;
      const type=photo.headers.get("content-type")||"";
      if(!/^image\/(jpeg|png|webp|avif)/i.test(type))continue;
      const bytes=Buffer.from(await photo.arrayBuffer());
      if(bytes.length<2000||bytes.length>6000000)continue;
      res.setHeader("Content-Type",type);res.status(200).end(bytes);return;
    }catch{}
  }
  res.status(404).send("Property image currently unavailable");
}
