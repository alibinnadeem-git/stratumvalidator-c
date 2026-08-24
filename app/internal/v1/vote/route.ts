import {NextRequest,NextResponse} from 'next/server';
import {signVote} from '@/lib/server/serverless-chain';
export const runtime='nodejs';
export async function POST(req:NextRequest){try{const expected=process.env.STRATUM_PEER_API_KEY;if(!expected||req.headers.get('authorization')!==`Bearer ${expected}`)return NextResponse.json({error:'Unauthorized'},{status:401});const body=await req.json();return NextResponse.json(await signVote(body.record,body.txHash))}catch(e:any){return NextResponse.json({error:e.message||'Vote failed'},{status:400})}}
