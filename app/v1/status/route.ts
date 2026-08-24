import {NextResponse} from 'next/server';
import {chainStatus} from '@/lib/server/serverless-chain';
export const runtime='nodejs';
export async function GET(){try{return NextResponse.json(await chainStatus())}catch(e:any){return NextResponse.json({connected:false,mode:'vercel-serverless-devnet',error:e.message},{status:503})}}
