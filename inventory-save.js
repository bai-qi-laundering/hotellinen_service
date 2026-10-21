/* Bounded UI waits; a timed-out Firestore write may still be acknowledged later. */
(function(root){
 const active=new Map();
 const key=(date,hotel,item)=>JSON.stringify([date,hotel,item]);
 function withTimeout(promise,ms,message){
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(message)),ms);Promise.resolve(promise).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});
 }
 function run(id,work){
  if(active.has(id))return active.get(id);
  const task=Promise.resolve().then(work);active.set(id,task);
  task.then(()=>{if(active.get(id)===task)active.delete(id);},()=>{if(active.get(id)===task)active.delete(id);});return task;
 }
 function cacheItem(input){
  const data={...input};
  // Only confirmed data can replace signatures with a cloud placeholder.
  if(data.isSubmitted&&!data.isSaving&&!data.saveError&&!data.hasSigned&&!data.doubleHasSigned){
   for(const field of ['signature','doubleSignature'])if(data[field]&&data[field].length>100)data[field]='CACHED';
  }
  if(data.isSaving){data.isSaving=false;data.saveError=true;data.isSubmitted=false;}
  return data;
 }
 function recover(inputs){
  for(const hotels of Object.values(inputs || {}))for(const items of Object.values(hotels || {}))for(const data of Object.values(items || {})){
   if(data&&typeof data==='object'&&data.isSaving){data.isSaving=false;data.saveError=true;data.isSubmitted=false;}
  }
  return inputs;
 }
 const api={key,withTimeout,run,pending:id=>active.has(id),cacheItem,recover};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.InventorySave=api;
})(typeof window==='object'?window:globalThis);
