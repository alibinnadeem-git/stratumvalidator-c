import {createPrivateKey,createPublicKey,sign as cryptoSign,verify as cryptoVerify,KeyObject} from 'crypto';
import {query,tx} from './db';
import {canonicalize,sha256} from './hash';
import {transactionHash,validateRecord,validatorAddress} from './serverless-chain';
import type {LedgerRecord} from '../ledger';

export const POVI_PROTOCOL_VERSION='POVI/1' as const;
export const POVI_ENGINE_PROFILE='POVI-P0-COMPAT/1' as const;
const CHAIN_ID=()=>process.env.STRATUM_CHAIN_ID||'stratum-devnet-1';

type ValidatorConfig={id:string;name:string;url:string;publicKeyB64:string;address:string};
type SignedVote={validatorId:string;proposalHash:string;stateRoot?:string;messageHash:string;signature:string};
type DirHeader={chainId:string;height:number;round:number;previousDIRHash:string;orderedMicroDIRRoot:string;stateRoot:string;validatorSetRoot:string;protocolVersion:string;proposerId:string;entropyVRFEvidence:{mode:'PRE_VRF_COMPATIBILITY';seedHash:string}};
type Proposal={domain:'STRATUM/POVI/PROPOSAL/1';chainId:string;height:number;round:number;validatorSetRoot:string;protocolVersion:string;proposalHash:string;DIRCandidateHeader:DirHeader;proposerId:string;VRFProof:null;signature:string};
type PLC={chainId:string;height:number;round:number;proposalHash:string;signerIds:string[];VERIFYSignatures:SignedVote[];validatorSetRoot:string;protocolVersion:string};
type PFC={chainId:string;height:number;round:number;DIRHash:string;proposalHash:string;stateRoot:string;validatorSetRoot:string;protocolVersion:string;signerIds:string[];COMMITSignatures:SignedVote[]};

type ChainStateRow={height:string;latest_block_hash:string;genesis_hash:string};
type ChainTxRow={tx_hash:string;record_id:string;block_height:string|null;block_hash:string|null;finalized_at:Date|null;status:string};

actionableVoid();
function actionableVoid(){/* module marker for deterministic bundlers */}

export function requiredPoviQuorum(activeValidatorCount:number){
 if(!Number.isInteger(activeValidatorCount)||activeValidatorCount<1)throw new Error('activeValidatorCount must be a positive integer');
 return Math.floor((2*activeValidatorCount)/3)+1;
}

function expectedValidators():ValidatorConfig[]{
 return ['A','B','C'].map(letter=>{
  const id=(process.env[`STRATUM_VALIDATOR_${letter}_ID`]||`validator-${letter.toLowerCase()}`).trim();
  const name=process.env[`STRATUM_VALIDATOR_${letter}_NAME`]||`STRATUM Validator ${letter}`;
  const url=(process.env[`STRATUM_VALIDATOR_${letter}_URL`]||'').replace(/\/$/,'');
  const publicKeyB64=process.env[`STRATUM_VALIDATOR_${letter}_PUBLIC_KEY_B64`]||'';
  if(!publicKeyB64)throw new Error(`STRATUM_VALIDATOR_${letter}_PUBLIC_KEY_B64 is required`);
  return{id,name,url,publicKeyB64,address:validatorAddress(publicKeyB64)};
 });
}
function selfConfig(){
 const id=process.env.STRATUM_VALIDATOR_ID||'validator-a';
 const found=expectedValidators().find(v=>v.id===id);
 if(!found)throw new Error(`Unknown STRATUM_VALIDATOR_ID ${id}`);
 return found;
}
function selfPrivateKey():KeyObject{
 const b64=process.env.STRATUM_VALIDATOR_PRIVATE_KEY_B64;
 if(!b64)throw new Error('STRATUM_VALIDATOR_PRIVATE_KEY_B64 is required');
 return createPrivateKey({key:Buffer.from(b64,'base64'),format:'der',type:'pkcs8'});
}
function pubKey(b64:string){return createPublicKey({key:Buffer.from(b64,'base64'),format:'der',type:'spki'});}
function signDigest(hash:string){return cryptoSign(null,Buffer.from(hash,'hex'),selfPrivateKey()).toString('base64');}
function verifyDigest(hash:string,signature:string,publicKeyB64:string){return cryptoVerify(null,Buffer.from(hash,'hex'),pubKey(publicKeyB64),Buffer.from(signature,'base64'));}

function validatorSetRoot(validators=expectedValidators()){
 return sha256(canonicalize(validators.map(v=>({validatorId:v.id,address:v.address,publicKeyB64:v.publicKeyB64})).sort((a,b)=>a.validatorId.localeCompare(b.validatorId))));
}
function stateRootForCompatibility(previousDIRHash:string,txHash:string){
 return sha256(canonicalize({profile:'COMPATIBILITY_RECORD_STATE/1',previousDIRHash,orderedMicroDIRRoot:txHash}));
}
function signedMessageHash(domain:string,payload:Record<string,unknown>){return sha256(canonicalize({domain,...payload}));}
function verifyValidatorSignature(validatorId:string,messageHash:string,signature:string){
 const validator=expectedValidators().find(v=>v.id===validatorId);
 return Boolean(validator&&verifyDigest(messageHash,signature,validator.publicKeyB64));
}

async function ensurePoviTables(){
 await query(`CREATE TABLE IF NOT EXISTS sv_povi_rounds(
  chain_id text NOT NULL,height bigint NOT NULL,round integer NOT NULL DEFAULT 0,proposal_hash text NOT NULL,tx_hash text NOT NULL,
  state_root text NOT NULL,validator_set_root text NOT NULL,header_json jsonb NOT NULL,status text NOT NULL DEFAULT 'PROPOSED',
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(chain_id,height,round),UNIQUE(chain_id,tx_hash))`);
 await query(`CREATE TABLE IF NOT EXISTS sv_povi_messages(
  chain_id text NOT NULL,height bigint NOT NULL,round integer NOT NULL,step text NOT NULL,validator_id text NOT NULL,
  proposal_hash text NOT NULL,state_root text,message_hash text NOT NULL,signature text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(chain_id,height,round,step,validator_id))`);
 await query(`CREATE TABLE IF NOT EXISTS sv_povi_certificates(
  chain_id text NOT NULL,height bigint NOT NULL,round integer NOT NULL,proposal_hash text NOT NULL,state_root text NOT NULL,
  validator_set_root text NOT NULL,plc_json jsonb NOT NULL,pfc_json jsonb NOT NULL,dir_hash text NOT NULL,finalized_at timestamptz NOT NULL,
  PRIMARY KEY(chain_id,height,round),UNIQUE(chain_id,dir_hash))`);
}

function proposalHashFor(header:DirHeader){
 return sha256(canonicalize({domain:'STRATUM/POVI/PROPOSAL/1',DIRCandidateHeader:header}));
}
function proposalSignatureHash(proposalHash:string,header:DirHeader){
 return signedMessageHash('STRATUM/POVI/PROPOSAL/1',{proposalHash,chainId:header.chainId,height:header.height,round:header.round,validatorSetRoot:header.validatorSetRoot,protocolVersion:header.protocolVersion});
}
function verifyMessageHash(proposal:Proposal){
 return signedMessageHash('STRATUM/POVI/VERIFY/1',{chainId:proposal.chainId,height:proposal.height,round:proposal.round,step:'VERIFY',proposalHash:proposal.proposalHash,validatorSetRoot:proposal.validatorSetRoot,protocolVersion:proposal.protocolVersion});
}
function commitMessageHash(proposal:Proposal){
 return signedMessageHash('STRATUM/POVI/COMMIT/1',{chainId:proposal.chainId,height:proposal.height,round:proposal.round,step:'COMMIT',proposalHash:proposal.proposalHash,stateRoot:proposal.DIRCandidateHeader.stateRoot,validatorSetRoot:proposal.validatorSetRoot,protocolVersion:proposal.protocolVersion});
}

function assertProposal(proposal:Proposal,record:LedgerRecord){
 validateRecord(record);
 if(proposal.domain!=='STRATUM/POVI/PROPOSAL/1'||proposal.protocolVersion!==POVI_PROTOCOL_VERSION)throw new Error('Unsupported PoVI proposal');
 if(proposal.chainId!==CHAIN_ID())throw new Error('Proposal chainId mismatch');
 const validators=expectedValidators();
 const expectedRoot=validatorSetRoot(validators);
 if(proposal.validatorSetRoot!==expectedRoot||proposal.DIRCandidateHeader.validatorSetRoot!==expectedRoot)throw new Error('Validator set root mismatch');
 if(proposal.DIRCandidateHeader.orderedMicroDIRRoot!==transactionHash(record))throw new Error('Proposal orderedMicroDIRRoot mismatch');
 if(proposalHashFor(proposal.DIRCandidateHeader)!==proposal.proposalHash)throw new Error('Proposal hash mismatch');
 const proposer=validators.find(v=>v.id===proposal.proposerId);
 if(!proposer)throw new Error('Unknown proposer');
 const signatureHash=proposalSignatureHash(proposal.proposalHash,proposal.DIRCandidateHeader);
 if(!verifyDigest(signatureHash,proposal.signature,proposer.publicKeyB64))throw new Error('Invalid proposal signature');
}

async function persistSignedMessage(args:{proposal:Proposal;step:'VERIFY'|'COMMIT';messageHash:string;signature:string;validatorId:string}){
 await ensurePoviTables();
 await tx(async c=>{
  const existing=await c.query<{proposal_hash:string;message_hash:string;signature:string}>(
   `SELECT proposal_hash,message_hash,signature FROM sv_povi_messages WHERE chain_id=$1 AND height=$2 AND round=$3 AND step=$4 AND validator_id=$5 FOR UPDATE`,
   [args.proposal.chainId,args.proposal.height,args.proposal.round,args.step,args.validatorId],
  );
  if(existing.rows[0]){
   if(existing.rows[0].proposal_hash!==args.proposal.proposalHash||existing.rows[0].message_hash!==args.messageHash){
    throw new Error(`Equivocation protection: ${args.validatorId} already signed another ${args.step} message at this height/round`);
   }
   return;
  }
  await c.query(
   `INSERT INTO sv_povi_messages(chain_id,height,round,step,validator_id,proposal_hash,state_root,message_hash,signature) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
   [args.proposal.chainId,args.proposal.height,args.proposal.round,args.step,args.validatorId,args.proposal.proposalHash,args.proposal.DIRCandidateHeader.stateRoot,args.messageHash,args.signature],
  );
 });
}

export async function signVerify(proposal:Proposal,record:LedgerRecord):Promise<SignedVote>{
 assertProposal(proposal,record);
 const self=selfConfig();
 const messageHash=verifyMessageHash(proposal);
 const signature=signDigest(messageHash);
 await persistSignedMessage({proposal,step:'VERIFY',messageHash,signature,validatorId:self.id});
 return{validatorId:self.id,proposalHash:proposal.proposalHash,messageHash,signature};
}

function verifyPLC(proposal:Proposal,plc:PLC){
 if(plc.chainId!==proposal.chainId||plc.height!==proposal.height||plc.round!==proposal.round||plc.proposalHash!==proposal.proposalHash)throw new Error('PLC context mismatch');
 if(plc.validatorSetRoot!==proposal.validatorSetRoot||plc.protocolVersion!==POVI_PROTOCOL_VERSION)throw new Error('PLC validator/protocol mismatch');
 const validators=expectedValidators();
 const unique=new Map(plc.VERIFYSignatures.map(v=>[v.validatorId,v]));
 if(unique.size<requiredPoviQuorum(validators.length))throw new Error('PLC does not meet PoVI quorum');
 const expectedHash=verifyMessageHash(proposal);
 for(const vote of unique.values()){
  if(vote.proposalHash!==proposal.proposalHash||vote.messageHash!==expectedHash||!verifyValidatorSignature(vote.validatorId,vote.messageHash,vote.signature))throw new Error(`Invalid VERIFY proof from ${vote.validatorId}`);
 }
}

export async function signCommit(proposal:Proposal,record:LedgerRecord,plc:PLC):Promise<SignedVote>{
 assertProposal(proposal,record);
 verifyPLC(proposal,plc);
 const self=selfConfig();
 const messageHash=commitMessageHash(proposal);
 const signature=signDigest(messageHash);
 await persistSignedMessage({proposal,step:'COMMIT',messageHash,signature,validatorId:self.id});
 return{validatorId:self.id,proposalHash:proposal.proposalHash,stateRoot:proposal.DIRCandidateHeader.stateRoot,messageHash,signature};
}

async function postPeer<T>(validator:ValidatorConfig,path:string,body:unknown):Promise<T>{
 if(!validator.url)throw new Error(`${validator.id} has no endpoint`);
 const secret=process.env.STRATUM_PEER_API_KEY;
 if(!secret)throw new Error('STRATUM_PEER_API_KEY is required');
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),4500);
 try{
  const response=await fetch(`${validator.url}${path}`,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${secret}`},body:JSON.stringify(body),cache:'no-store',signal:controller.signal});
  if(!response.ok)throw new Error(`${validator.id} ${path} HTTP ${response.status}`);
  return await response.json() as T;
 }finally{clearTimeout(timer);}
}

function assertVote(vote:SignedVote,proposal:Proposal,step:'VERIFY'|'COMMIT'){
 const expectedHash=step==='VERIFY'?verifyMessageHash(proposal):commitMessageHash(proposal);
 if(vote.proposalHash!==proposal.proposalHash||vote.messageHash!==expectedHash||!verifyValidatorSignature(vote.validatorId,vote.messageHash,vote.signature))throw new Error(`Invalid ${step} vote from ${vote.validatorId}`);
}

async function collectPhase(proposal:Proposal,record:LedgerRecord,step:'VERIFY'|'COMMIT',plc?:PLC){
 const validators=expectedValidators();
 const self=selfConfig();
 const selfVote=step==='VERIFY'?await signVerify(proposal,record):await signCommit(proposal,record,plc!);
 const path=step==='VERIFY'?'/internal/v1/povi/verify':'/internal/v1/povi/commit';
 const peers=validators.filter(v=>v.id!==self.id);
 const settled=await Promise.allSettled(peers.map(v=>postPeer<SignedVote>(v,path,step==='VERIFY'?{proposal,record}:{proposal,record,plc})));
 const votes:SignedVote[]=[selfVote];
 for(const result of settled)if(result.status==='fulfilled')votes.push(result.value);
 const unique=[...new Map(votes.map(v=>[v.validatorId,v])).values()];
 for(const vote of unique)assertVote(vote,proposal,step);
 const required=requiredPoviQuorum(validators.length);
 if(unique.length<required)throw new Error(`PoVI ${step} quorum not reached: ${unique.length}/${validators.length}; ${required} required`);
 return unique;
}

async function prepareProposal(record:LedgerRecord):Promise<{proposal:Proposal;txHash:string;existingFinalized?:any}>{
 validateRecord(record);
 await ensurePoviTables();
 const txHash=transactionHash(record);
 const existing=await query<ChainTxRow>(`SELECT tx_hash,record_id,block_height,block_hash,finalized_at,status FROM sv_chain_transactions WHERE chain_id=$1 AND record_id=$2`,[CHAIN_ID(),record.recordId]);
 const row=existing.rows[0];
 if(row?.block_height&&row.finalized_at){
  if(row.tx_hash!==txHash)throw new Error('Record ID already exists with different content');
  const finalizedAt=row.finalized_at;
  return{txHash,proposal:null as never,existingFinalized:{network:CHAIN_ID(),txHash:row.tx_hash,blockHeight:Number(row.block_height),timestamp:finalizedAt.toISOString(),blockHash:row.block_hash,protocolVersion:'LEGACY_OR_PREVIOUS',poviConformant:false}};
 }
 const prepared=await tx(async c=>{
  await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`,[`${CHAIN_ID()}:povi-proposal`]);
  const prior=await c.query<any>(`SELECT header_json,proposal_hash,tx_hash FROM sv_povi_rounds WHERE chain_id=$1 AND tx_hash=$2 LIMIT 1`,[CHAIN_ID(),txHash]);
  if(prior.rows[0])return prior.rows[0];
  const state=await c.query<ChainStateRow>(`SELECT height,latest_block_hash,genesis_hash FROM sv_chain_state WHERE chain_id=$1 FOR UPDATE`,[CHAIN_ID()]);
  if(!state.rows[0])throw new Error('STRATUM serverless chain is not initialized');
  const height=Number(state.rows[0].height)+1;
  const round=0;
  const previousDIRHash=state.rows[0].latest_block_hash;
  const validators=expectedValidators();
  const root=validatorSetRoot(validators);
  const header:DirHeader={chainId:CHAIN_ID(),height,round,previousDIRHash,orderedMicroDIRRoot:txHash,stateRoot:stateRootForCompatibility(previousDIRHash,txHash),validatorSetRoot:root,protocolVersion:POVI_PROTOCOL_VERSION,proposerId:selfConfig().id,entropyVRFEvidence:{mode:'PRE_VRF_COMPATIBILITY',seedHash:sha256(canonicalize({previousDIRHash,height,round}))}};
  const proposalHash=proposalHashFor(header);
  await c.query(`INSERT INTO sv_chain_transactions(chain_id,tx_hash,record_id,organization_id,project_id,asset_id,event_type,evidence_hash,payload_hash,signer,record_timestamp,canonical_record,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,'PROPOSED') ON CONFLICT (chain_id,record_id) DO NOTHING`,[CHAIN_ID(),txHash,record.recordId,record.organizationId,record.projectId,record.assetId,record.type,record.evidenceHash,record.payloadHash||null,record.signer,record.timestamp,JSON.stringify(record)]);
  await c.query(`INSERT INTO sv_povi_rounds(chain_id,height,round,proposal_hash,tx_hash,state_root,validator_set_root,header_json,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'PROPOSED')`,[CHAIN_ID(),height,round,proposalHash,txHash,header.stateRoot,root,JSON.stringify(header)]);
  return{header_json:header,proposal_hash:proposalHash,tx_hash:txHash};
 });
 const header=prepared.header_json as DirHeader;
 const proposalHash=prepared.proposal_hash as string;
 const signature=signDigest(proposalSignatureHash(proposalHash,header));
 const proposal:Proposal={domain:'STRATUM/POVI/PROPOSAL/1',chainId:header.chainId,height:header.height,round:header.round,validatorSetRoot:header.validatorSetRoot,protocolVersion:POVI_PROTOCOL_VERSION,proposalHash,DIRCandidateHeader:header,proposerId:header.proposerId,VRFProof:null,signature};
 return{proposal,txHash};
}

export async function anchorPoviCompatibility(record:LedgerRecord){
 const prepared=await prepareProposal(record);
 if(prepared.existingFinalized)return prepared.existingFinalized;
 const {proposal,txHash}=prepared;
 const verifyVotes=await collectPhase(proposal,record,'VERIFY');
 const plc:PLC={chainId:proposal.chainId,height:proposal.height,round:proposal.round,proposalHash:proposal.proposalHash,signerIds:verifyVotes.map(v=>v.validatorId).sort(),VERIFYSignatures:verifyVotes,validatorSetRoot:proposal.validatorSetRoot,protocolVersion:POVI_PROTOCOL_VERSION};
 await query(`UPDATE sv_povi_rounds SET status='LOCKED',updated_at=now() WHERE chain_id=$1 AND height=$2 AND round=$3`,[proposal.chainId,proposal.height,proposal.round]);
 const commitVotes=await collectPhase(proposal,record,'COMMIT',plc);
 const signerIds=commitVotes.map(v=>v.validatorId).sort();
 const dirHash=sha256(canonicalize({domain:'STRATUM/DIR/1',header:proposal.DIRCandidateHeader,finality:{proposalHash:proposal.proposalHash,stateRoot:proposal.DIRCandidateHeader.stateRoot,validatorSetRoot:proposal.validatorSetRoot,protocolVersion:POVI_PROTOCOL_VERSION,signerIds}}));
 const pfc:PFC={chainId:proposal.chainId,height:proposal.height,round:proposal.round,DIRHash:dirHash,proposalHash:proposal.proposalHash,stateRoot:proposal.DIRCandidateHeader.stateRoot,validatorSetRoot:proposal.validatorSetRoot,protocolVersion:POVI_PROTOCOL_VERSION,signerIds,COMMITSignatures:commitVotes};
 const finalizedAt=new Date().toISOString();
 const validators=expectedValidators();
 await tx(async c=>{
  await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`,[proposal.chainId]);
  const state=await c.query<ChainStateRow>(`SELECT height,latest_block_hash,genesis_hash FROM sv_chain_state WHERE chain_id=$1 FOR UPDATE`,[proposal.chainId]);
  if(!state.rows[0]||Number(state.rows[0].height)+1!==proposal.height||state.rows[0].latest_block_hash!==proposal.DIRCandidateHeader.previousDIRHash)throw new Error('Chain head changed before PoVI finalization; begin a higher-round/reproposal flow');
  await c.query(`INSERT INTO sv_chain_blocks(chain_id,height,block_hash,prev_hash,tx_hash,proposer_validator_id,finalized_at,votes_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,[proposal.chainId,proposal.height,dirHash,proposal.DIRCandidateHeader.previousDIRHash,txHash,proposal.proposerId,finalizedAt,JSON.stringify({protocolVersion:POVI_PROTOCOL_VERSION,PLC:plc,PFC:pfc})]);
  for(const vote of commitVotes){
   const validator=validators.find(v=>v.id===vote.validatorId)!;
   await c.query(`INSERT INTO sv_chain_votes(chain_id,tx_hash,validator_id,validator_address,signature,public_key_b64) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[proposal.chainId,txHash,validator.id,validator.address,vote.signature,validator.publicKeyB64]);
  }
  await c.query(`UPDATE sv_chain_transactions SET status='FINALIZED',block_height=$3,block_hash=$4,finalized_at=$5 WHERE chain_id=$1 AND tx_hash=$2`,[proposal.chainId,txHash,proposal.height,dirHash,finalizedAt]);
  await c.query(`UPDATE sv_chain_state SET height=$2,latest_block_hash=$3,updated_at=now() WHERE chain_id=$1`,[proposal.chainId,proposal.height,dirHash]);
  await c.query(`UPDATE sv_povi_rounds SET status='FINALIZED',updated_at=now() WHERE chain_id=$1 AND height=$2 AND round=$3`,[proposal.chainId,proposal.height,proposal.round]);
  await c.query(`INSERT INTO sv_povi_certificates(chain_id,height,round,proposal_hash,state_root,validator_set_root,plc_json,pfc_json,dir_hash,finalized_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10) ON CONFLICT (chain_id,height,round) DO UPDATE SET plc_json=EXCLUDED.plc_json,pfc_json=EXCLUDED.pfc_json,dir_hash=EXCLUDED.dir_hash,finalized_at=EXCLUDED.finalized_at`,[proposal.chainId,proposal.height,proposal.round,proposal.proposalHash,proposal.DIRCandidateHeader.stateRoot,proposal.validatorSetRoot,JSON.stringify(plc),JSON.stringify(pfc),dirHash,finalizedAt]);
 });
 return{network:proposal.chainId,txHash,blockHeight:proposal.height,timestamp:finalizedAt,blockHash:dirHash,DIRHash:dirHash,protocolVersion:POVI_PROTOCOL_VERSION,engineProfile:POVI_ENGINE_PROFILE,quorum:requiredPoviQuorum(validators.length),validatorVotes:signerIds,PLC:plc,PFC:pfc,poviConformant:false,conformanceNotes:['PROPOSE/VERIFY/LOCK/COMMIT/PFC finality active in compatibility profile','Static validator registry remains','VRF proposer selection remains pre-VRF compatibility','State root is a compatibility record root until deterministic state execution is activated']};
}

export function poviCapabilities(){
 const validators=expectedValidators();
 return{protocolVersion:POVI_PROTOCOL_VERSION,engineProfile:POVI_ENGINE_PROFILE,engineReady:true,poviConformant:false,activeValidatorCount:validators.length,requiredQuorum:requiredPoviQuorum(validators.length),phases:['PROPOSE','VERIFY','LOCK','COMMIT','FINALIZE'],certificates:['PLC','PFC'],limitations:['STATIC_VALIDATOR_REGISTRY','PRE_VRF_PROPOSER','COMPATIBILITY_STATE_ROOT','PUBLIC_LEGACY_ENDPOINT_REMAINS_DEFAULT']};
}

export type {Proposal,PLC,PFC,SignedVote};
