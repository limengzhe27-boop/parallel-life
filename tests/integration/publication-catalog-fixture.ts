import assert from 'node:assert/strict';
/** Persistent local fixture databases can have multiple directory pages. Always locate by exact work ID. */
export async function findPublicationCard<T extends {id:string}>(read:(input:{limit:number;cursor?:string})=>Promise<{works:T[];nextCursor:string|null}>,id:string):Promise<T|undefined>{
 let cursor:string|undefined;
 for(let page=0;page<100;page++){
  const next=await read({limit:100,...(cursor?{cursor}:{})});const found=next.works.find(c=>c.id===id);
  if(found||!next.nextCursor)return found;
  assert.notEqual(next.nextCursor,cursor);cursor=next.nextCursor;
 }
 throw Error('Local fixture catalog exceeded bounded cursor traversal');
}
