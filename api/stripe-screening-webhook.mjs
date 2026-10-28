import {verifyStripeEvent} from '../lib/stripe-listing.mjs';
import {testConfiguration,fulfillScreening} from '../lib/screening.mjs';
import {screeningStore} from '../lib/screening-store.mjs';
export const config={api:{bodyParser:false}};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({error:'POST required'});
 try{testConfiguration();if(!process.env.STRIPE_SCREENING_TEST_WEBHOOK_SECRET)throw Error();}catch{return res.status(503).json({error:'Test webhook unavailable'});}
 let event;try{let n=0;const chunks=[];for await(const c of req){n+=c.length;if(n>1048576)throw Error();chunks.push(c);}event=verifyStripeEvent(Buffer.concat(chunks),req.headers['stripe-signature'],process.env.STRIPE_SCREENING_TEST_WEBHOOK_SECRET);}catch{return res.status(400).json({error:'Invalid signature'});}
 try{const result=await fulfillScreening(event,{store:screeningStore});return res.json({received:true,result});}catch{return res.status(503).json({error:'Staff review required before retrying a test screening'});}
}
