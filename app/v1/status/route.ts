import {NextResponse} from 'next/server';
import {chainStatus} from '@/lib/server/serverless-chain';
import {poviCapabilities} from '@/lib/server/povi';
export const runtime='nodejs';
// Deployment marker: staged POVI-P0-COMPAT/1 capability release, 2026-09-11.
export async function GET(){
 try{return NextResponse.json({...await chainStatus(),povi:poviCapabilities()});}
 catch(e:any){return NextResponse.json({connected:false,mode:'vercel-serverless-devnet',povi:{engineReady:false,poviConformant:false},error:e.message},{status:503});}
}
