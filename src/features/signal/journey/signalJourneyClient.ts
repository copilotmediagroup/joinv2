import { supabase } from '../../../lib/supabaseClient'
import type { SignalJourneyStage } from '../realtime/contract'
export async function advanceMySignalJourneyStage(signalGroupId:string,stage:Extract<SignalJourneyStage,'arrival'|'places'|'time'>):Promise<SignalJourneyStage>{const {data,error}=await supabase.rpc('advance_my_signal_journey_stage',{p_signal_group_id:signalGroupId,p_stage:stage});if(error)throw new Error(error.message||'Unable to advance Signal stage');if(typeof data!=='string')throw new Error('Invalid Signal journey stage response');return data as SignalJourneyStage}
