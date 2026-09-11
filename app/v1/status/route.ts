import {NextResponse} from 'next/server';
import {chainStatus} from '@/lib/server/serverless-chain';
import {poviCapabilities} from '@/lib/server/povi';
import {stagedRegistryStatus} from '@/lib/server/validator-registry';
export const runtime='nodejs';
export async function GET(){
 try{const chain=await chainStatus();return NextResponse.json({...chain,povi:poviCapabilities(),validatorRegistry:await stagedRegistryStatus(chain.height)});}
 catch(e:any){return NextResponse.json({connected:false,mode:'vercel-serverless-devnet',povi:{engineReady:false,poviConformant:false},validatorRegistry:{authoritativeForConsensus:false},error:e.message},{status:503});}
}
