import { supabase } from '../../lib/supabaseClient'
import { createProfileAvatarSignedUrls } from '../onboarding/avatarClient'

export type SignalProfileSearchResult={userId:string;displayName:string;avatarUrl:string|null;cityName:string|null;stateCode:string|null}
function requiredText(value:unknown,field:string):string{if(typeof value!=='string'||!value.trim())throw new Error('Invalid profile search response: '+field);return value}

export async function searchSignalProfiles(query:string):Promise<SignalProfileSearchResult[]>{
 const normalized=query.trim().slice(0,80); if(normalized.length<2)return []
 const {data,error}=await supabase.rpc('search_signal_profiles',{p_query:normalized,p_limit:12})
 if(error)throw new Error(error.message||'Unable to search SIGNAL right now.'); if(!Array.isArray(data))throw new Error('Invalid profile search response.')
 const rows=data as Record<string,unknown>[]
 const paths=rows.map((row)=>typeof row.avatar_path==='string'&&row.avatar_path.trim()?row.avatar_path:null).filter((path):path is string=>path!==null)
 const urls=await createProfileAvatarSignedUrls([...new Set(paths)]).catch(()=>new Map<string,string>())
 return rows.map((row)=>{const avatarPath=typeof row.avatar_path==='string'&&row.avatar_path.trim()?row.avatar_path:null;return{userId:requiredText(row.user_id,'user_id'),displayName:requiredText(row.display_name,'display_name'),avatarUrl:avatarPath?urls.get(avatarPath)??null:null,cityName:typeof row.city_name==='string'&&row.city_name.trim()?row.city_name:null,stateCode:typeof row.state_code==='string'&&row.state_code.trim()?row.state_code:null}})
}
