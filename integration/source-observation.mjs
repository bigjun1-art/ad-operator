/** Combine source collection times while retaining uncertainty from any dependency. */
export function mergeSourceObservation(data,{times=[],unknown=false,receivedAt=Date.now(),allowReceiptTime=false}={}){
 if(!data||typeof data!=='object'||Array.isArray(data))return data;
 const candidates=[...times];for(const key of ['observedAt','sourceObservedAt'])if(Object.hasOwn(data,key))candidates.push(data[key]);
 const valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
 const uncertain=unknown||data.observationTimeUnknown===true||candidates.some(t=>!valid(t)||t>receivedAt);
 if(uncertain)return {...data,observedAt:null,sourceObservedAt:null,observationTimeUnknown:true,fetchedAt:receivedAt,observationTimeBasis:'source_time_unknown'};
 if(candidates.length){const oldest=Math.min(...candidates);return {...data,observedAt:oldest,sourceObservedAt:oldest,fetchedAt:receivedAt,observationTimeBasis:'oldest_source_response'};}
 return allowReceiptTime?{...data,observedAt:receivedAt,sourceObservedAt:receivedAt,fetchedAt:receivedAt,observationTimeBasis:'response_received'}:{...data,observedAt:null,sourceObservedAt:null,observationTimeUnknown:true,fetchedAt:receivedAt,observationTimeBasis:'source_time_unknown'};
}
