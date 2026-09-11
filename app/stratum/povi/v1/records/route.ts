import {NextRequest,NextResponse} from 'next/server';
import {anchorPoviCompatibility} from '@/lib/server/povi';
export const runtime='nodejs';
export const maxDuration=20;
export async function POST(req:NextRequest){
 try{
  const expected=process.env.STRATUM_PUBLIC_API_KEY;
  if(!expected||req.headers.get('authorization')!==`Bearer ${expected}`)return NextResponse.json({error:'Unauthorized'},{status:401});
  return NextResponse.json(await anchorPoviCompatibility(await req.json()));
 }catch(e:any){return NextResponse.json({error:e.message||'PoVI anchor failed'},{status:400});}
}
