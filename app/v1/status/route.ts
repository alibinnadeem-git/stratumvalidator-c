import {NextResponse} from 'next/server';
import {chainStatus} from '@/lib/server/serverless-chain';
import {poviCapabilities} from '@/lib/server/povi';
export const runtime='nodejs';
export async function GET(){
 try{return NextResponse.json({...await chainStatus(),povi:poviCapabilities()});}
 catch(e:any){return NextResponse.json({connected:false,mode:'vercel-serverless-devnet',povi:{engineReady:false,poviConformant:false},error:e.message},{status:503});}
}
