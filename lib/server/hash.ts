import {createHash} from 'crypto';
export function canonicalize(value:unknown):string{if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(canonicalize).join(',')}]`;const o=value as Record<string,unknown>;return `{${Object.keys(o).sort().map(k=>`${JSON.stringify(k)}:${canonicalize(o[k])}`).join(',')}}`}
export const sha256=(input:string|Buffer)=>createHash('sha256').update(input).digest('hex');
