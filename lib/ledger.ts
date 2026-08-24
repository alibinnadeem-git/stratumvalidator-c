export type LifecycleEventType='REGISTER_ASSET'|'PROCURE'|'SHIP'|'TRANSFER_CUSTODY'|'RECEIVE'|'INSTALL'|'INSPECT'|'TEST'|'COMMISSION'|'ENERGIZE'|'MAINTAIN'|'REPAIR'|'REPLACE'|'DECOMMISSION';
export type LedgerRecord={organizationId:string;projectId:string;assetId:string;recordId:string;type:LifecycleEventType;evidenceHash:string;timestamp:string;signer:string;payloadHash?:string};
export type AnchorReceipt={network:string;txHash:string;blockHeight:number;timestamp:string};
