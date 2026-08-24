import {Pool,PoolClient,QueryResultRow} from 'pg';
let pool:Pool|undefined;
export function db(){if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is not configured');if(!pool)pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined,max:process.env.NODE_ENV==='production'?2:10});return pool}
export async function query<T extends QueryResultRow=QueryResultRow>(text:string,values:unknown[]=[]){return db().query<T>(text,values)}
export async function tx<T>(fn:(client:PoolClient)=>Promise<T>){const c=await db().connect();try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
