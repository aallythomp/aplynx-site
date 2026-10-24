// Vercel server-only status. Never return credentials or perform paid screening here.
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store, max-age=0');
  if(req.method!=='GET')return res.status(405).json({ok:false});
  // The test key is not intended for production; no public production diagnostics.
  if(process.env.VERCEL_ENV!=='preview' && process.env.VERCEL_ENV!=='development')return res.status(404).json({ok:false});
  return res.status(200).json({
    ok:true,
    environment:'test',
    keyConfigured:Boolean(process.env.CHECKR_TEST_API_KEY),
    screeningEnabled:false,
    paymentCollectionEnabled:false,
    checkrConnectionTested:false,
    note:'Configuration presence only; this does not establish Checkr API connectivity.'
  });
}
