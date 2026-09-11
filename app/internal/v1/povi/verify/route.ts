import {NextRequest,NextResponse} from 'next/server';
import {signVerify} from '@/lib/server/povi';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 try{
  const expected=process.env.STRATUM_PEER_API_KEY;
  if(!expected||req.headers.get('authorization')!==`Bearer ${expected}`)return NextResponse.json({error:'Unauthorized'},{status:401});
  const body=await req.json();
  return NextResponse.json(await signVerify(body.proposal,body.record));
 }catch(e:any){return NextResponse.json({error:e.message||'PoVI VERIFY failed'},{status:400});}
}
