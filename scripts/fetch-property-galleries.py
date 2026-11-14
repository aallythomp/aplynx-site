import json, os, re, io, time
from pathlib import Path
from urllib.parse import urljoin, urlparse
import requests
from bs4 import BeautifulSoup
from PIL import Image

SOURCES = {
 "654 Ladora Drive": ["https://movewithmomentum.com/listings/idx-gamls/654-ladora-drive-dallas", "https://www.mackreynolds.com/homes-for-sale/654-Ladora-Drive-Dallas-GA-30157-437516761"],
 "9450 Pebble Creek Court": ["https://www.georgiamls.com/9450-pebble-creek-court-villa-rica-ga-30180/10757184", "https://www.westgeorgiahomes.com/property-search/detail/58/10757184/9450-pebble-creek-court-villa-rica-ga-30180/"],
 "70 S Beckman Court S": ["https://movewithmomentum.com/listings/idx-gamls/70-s-beckman-court-dallas", "https://www.mackreynolds.com/homes-for-sale/70-S-Beckman-Court-Dallas-GA-30132-434874027"],
 "1517 Fenmore Street": ["https://movewithmomentum.com/listings/idx-gamls/1517-fenmore-street-lithia-springs", "https://www.georgiamls.com/1517-fenmore-street-lithia-springs-ga-30122/10802686"],
 "434 Hunt Creek Drive": ["https://movewithmomentum.com/listings/idx-gamls/434-hunt-creek-drive-acworth", "https://www.georgiamls.com/434-hunt-creek-drive-acworth-ga-30101/10695122"],
 "3801 Stonewall Drive": ["https://movewithmomentum.com/listings/idx-gamls/3801-stonewall-drive-kennesaw", "https://www.coldwellbankerhomes.com/ga/kennesaw/3801-stonewall-dr/pid_69759550/"],
 "5012 Serenity Point Lane": ["https://movewithmomentum.com/listings/idx-gamls/5012-serenity-point-lane-villa-rica", "https://www.crye-leike.com/p/5012-Serenity-Point-Lane-Villa-Rica-GA-30180/dmgid_188888333"],
 "330 Peach Crossing Drive": ["https://movewithmomentum.com/listings/idx-gamls/330-peach-crossing-drive-dallas", "https://www.zillow.com/homedetails/330-Peach-Crossing-Dr-Dallas-GA-30132/237702190_zpid/"],
 "228 Stephens Mill Drive": ["https://movewithmomentum.com/listings/idx-gamls/228-stephens-mill-drive-dallas", "https://www.mackreynolds.com/homes-for-sale/228-Stephens-Mill-Drive-Dallas-GA-30157-432787826"],
 "4423 Turnberry Court": ["https://www.coldwellbankerhomes.com/ga/douglasville/4423-turnberry-ct/pid_72300119/"],
 "6061 Ridge Way": ["https://www.coldwellbankerhomes.com/ga/douglasville/6061-ridge-way/pid_71422395/"],
 "383 Robin Hood Drive": ["https://movewithmomentum.com/listings/idx-gamls/383-robin-hood-drive-douglasville"],
 "51 Bridgemill Run": ["https://movewithmomentum.com/listings/idx-gamls/51-bridgemill-run-douglasville"],
 "252 Bridge Place": ["https://movewithmomentum.com/listings/idx-gamls/252-bridge-place-douglasville"],
 "76 Foliage Court": ["https://www.georgiamls.com/76-foliage-court-dallas-ga-30132/10719219", "https://www.sheriemigh.com/homes-for-sale/76-Foliage-Court-Dallas-GA-30132-430002485"]
}

session = requests.Session()
session.headers.update({"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36","Accept-Language":"en-US,en;q=0.9"})
outdir=Path("assets/property-galleries")
outdir.mkdir(parents=True, exist_ok=True)
mapping=json.loads(Path('assets/property-galleries.json').read_text('utf8')) if Path('assets/property-galleries.json').exists() else {}
page=Path("homes-for-sale.html").read_text("utf8")

def slug(name):
 return re.sub(r"[^a-z0-9]+","-",name.lower()).strip("-")

def candidates(soup, base, name):
 found=[]
 for key in ("og:image","og:image:secure_url","twitter:image"):
  for tag in soup.select('meta[property="'+key+'"],meta[name="'+key+'"]'):
   if tag.get('content'): found.append((0, urljoin(base,tag['content']),""))
 for img in soup.select("img,source"):
  alt=(img.get("alt") or "").lower()
  values=[img.get(k) for k in ("data-src","data-lazy-src","data-original","data-full","data-image","src")]
  for srcset in (img.get("srcset"),img.get("data-srcset")):
   if srcset: values.extend([v.strip().split(" ")[0] for v in srcset.split(",")])
  for value in values:
   if not value:continue
   try: url=urljoin(base,value.replace("&amp;","&"))
   except Exception:continue
   priority=0 if any(word in alt for word in ("photo","property","home","living room","kitchen","bathroom","bedroom","exterior","interior")) else 1
   found.append((priority,url,alt))
 for tag in soup.select('a[href]'):
  href=tag.get('href','')
  if any(ext in href.lower() for ext in ('.jpg','.jpeg','.webp','.png')) or '/photos/' in href.lower():
   found.append((2,urljoin(base,href),""))
 seen=set(); result=[]
 for priority,u,alt in sorted(found, key=lambda v:v[0]):
  if u in seen:continue
  seen.add(u)
  if urlparse(u).scheme not in ("https","http"):continue
  if any(x in u.lower() for x in ("logo","avatar","icon","mapbox","maps.googleapis","streetview","captcha","floorplan","floor-plan","sprite","badge")):continue
  result.append(u)
 return result[:180]

for address, sources in SOURCES.items():
 key=slug(address); existing=[]
 cover=re.search(r'<h2>'+re.escape(address)+r'</h2>[\s\S]*?<img loading="lazy"[^>]+src="([^"]+)"',page)
 if cover:existing.append(cover.group(1))
 folder=outdir/key
 folder.mkdir(parents=True,exist_ok=True)
 saved=[]
 for existing_file in sorted(folder.glob("photo-*.jpg"))[:42]:saved.append("/"+existing_file.as_posix())
 if len(saved)>=36:
  mapping[key]=saved
  continue
 hashset=set()
 for path in sorted(folder.glob("photo-*.jpg")):
  try:
   current=Image.open(path).convert('L').resize((16,16),Image.Resampling.BILINEAR)
   hashset.add(hash(tuple(current.getdata())))
  except Exception: pass
 for p in sources:
  if len(saved)>=36:break
  try:
   resp=session.get(p,timeout=14)
   if not resp.ok:continue
   content=resp.text
   if address.lower().split()[0] not in content.lower():continue
   soup=BeautifulSoup(content,"html.parser")
   photos=candidates(soup,resp.url,address)
   print(key,"source",p,"candidates",len(photos),flush=True)
   for u in photos:
    if len(saved)>=36:break
    try:
     image_resp=session.get(u,timeout=12)
     if not image_resp.ok or len(image_resp.content)>7500000 or len(image_resp.content)<11000:continue
     im=Image.open(io.BytesIO(image_resp.content))
     if im.width<550 or im.height<360:continue
     if im.width/im.height>3 or im.height/im.width>2.5:continue
     im.thumbnail((1400,1100),Image.Resampling.LANCZOS)
     rgb=im.convert('RGB')
     small=rgb.resize((16,16),Image.Resampling.BILINEAR)
     digest=hash(tuple(small.convert('L').getdata()))
     if digest in hashset:continue
     hashset.add(digest)
     filename=folder/("photo-%02d.jpg"%(len(saved)+1))
     rgb.save(filename,"JPEG",quality=82,optimize=True)
     saved.append("/"+filename.as_posix())
    except Exception as ex:print("img failure",str(ex)[:75])
  except Exception as ex:print("page failure",key,str(ex)[:90])
 mapping[key]=saved
 print("GALLERY",address,len(saved),"images",flush=True)
 Path("assets/property-galleries.json").write_text(json.dumps(mapping,indent=2)+"\n","utf8")
