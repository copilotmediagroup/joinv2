import { ArrowLeft, MessageCircle, Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { toUserFacingError } from '../../lib/userFacingError'
import {
  getMyDirectMessages, getMyDirectThreads, markMyDirectConversationRead,
  sendMyDirectMessage, subscribeToDirectMessages,
  type DirectMessage, type DirectThread,
} from './directMessagingClient'

function time(value: string): string {
  const d = new Date(value); if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(d)
}

export default function DirectMessagesPanel({ currentUserId, initialConversationId = null }: { currentUserId: string, initialConversationId?: string | null }) {
  const [threads,setThreads]=useState<DirectThread[]>([])
  const [selectedId,setSelectedId]=useState<string|null>(initialConversationId)
  const [messages,setMessages]=useState<DirectMessage[]>([])
  const [draft,setDraft]=useState('')
  const [loading,setLoading]=useState(true)
  const [sending,setSending]=useState(false)
  const [error,setError]=useState<string|null>(null)

  const selected=useMemo(()=>threads.find(t=>t.conversationId===selectedId)??null,[threads,selectedId])
  const refreshThreads=useCallback(async()=>{ try{ setThreads(await getMyDirectThreads()); setError(null) }catch(e){ setError(toUserFacingError(e,'Unable to load direct messages right now.')) }finally{ setLoading(false) } },[])
  const refreshMessages=useCallback(async()=>{ if(!selectedId)return; try{ setMessages(await getMyDirectMessages(selectedId)); await markMyDirectConversationRead(selectedId); await refreshThreads(); setError(null) }catch(e){ setError(toUserFacingError(e,'Unable to load this conversation right now.')) } },[selectedId,refreshThreads])

  useEffect(()=>{ let active=true; queueMicrotask(()=>{if(active)void refreshThreads()}); return()=>{active=false} },[refreshThreads])
  useEffect(()=>{ if(!selectedId)return; let active=true; queueMicrotask(()=>{if(active)void refreshMessages()}); const stop=subscribeToDirectMessages(selectedId,()=>{if(active)void refreshMessages()}); return()=>{active=false;stop()} },[selectedId,refreshMessages])

  const send=async(e:FormEvent)=>{ e.preventDefault(); if(!selectedId||sending||!draft.trim())return; setSending(true);setError(null);try{await sendMyDirectMessage(selectedId,draft);setDraft('');await refreshMessages()}catch(err){setError(toUserFacingError(err,'Unable to send your message right now.'))}finally{setSending(false)} }

  if(selectedId){ return <section className="direct-thread">
    <header><button type="button" onClick={()=>{setSelectedId(null);setMessages([])}}><ArrowLeft size={16}/> DIRECT</button><div>{selected?.avatarUrl?<img src={selected.avatarUrl} alt=""/>:null}<strong>{selected?.displayName??'CONNECTED MEMBER'}</strong></div></header>
    {error?<p className="messages-error" role="alert">{error}</p>:null}
    <div className="messages-thread-feed">{messages.length===0?<div className="messages-empty-thread"><MessageCircle size={26}/><strong>Start the conversation</strong><span>You connected through SIGNAL.</span></div>:messages.map(m=><article key={m.messageId} className={m.senderUserId===currentUserId?'messages-bubble messages-bubble-mine':'messages-bubble'}><small>{m.senderUserId===currentUserId?'YOU':selected?.displayName??'CONNECTION'}</small><p>{m.body}</p><time>{time(m.sentAt)}</time></article>)}</div>
    <form className="messages-compose" onSubmit={send}><input value={draft} maxLength={4000} placeholder={`Message ${selected?.displayName??'connection'}...`} onChange={e=>setDraft(e.target.value)} disabled={sending}/><button type="submit" disabled={sending||!draft.trim()}><Send size={17}/></button></form>
  </section> }

  return <section className="direct-messages-panel"><div className="direct-messages-heading"><span>DIRECT</span><small>People you connected with through SIGNAL.</small></div>{error?<p className="messages-error" role="alert">{error}</p>:null}{loading?<div className="messages-state">Loading direct messages…</div>:threads.length===0?<div className="direct-messages-empty"><MessageCircle size={22}/><span>No direct conversations yet.</span></div>:threads.map(t=><button type="button" className="direct-thread-row" key={t.conversationId} onClick={()=>setSelectedId(t.conversationId)}>{t.avatarUrl?<img src={t.avatarUrl} alt=""/>:<span>{t.displayName.slice(0,1).toUpperCase()}</span>}<div><strong>{t.displayName}</strong><small>{t.lastMessageBody??'Connected through SIGNAL'}</small></div>{t.unreadCount>0?<b>{t.unreadCount}</b>:null}</button>)}</section>
}
