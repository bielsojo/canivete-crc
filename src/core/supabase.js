import { createClient } from '@supabase/supabase-js';

// URL e chave "anon public" vêm do .env (local) ou das variáveis do repositório (GitHub Actions).
// A chave anon só funciona para quem faz login; as regras de acesso estão no banco (RLS + RPCs).
const URL = import.meta.env.VITE_SUPABASE_URL || '';
const KEY = import.meta.env.VITE_SUPABASE_KEY || '';

export const CONFIGURADO = /^https:\/\/.+\.supabase\.co/.test(URL) && !!KEY && !/COLE_AQUI/.test(KEY);
export const sb = CONFIGURADO ? createClient(URL, KEY, {auth:{persistSession:true, autoRefreshToken:true}}) : null;

export async function rpc(name, args){
  const {data, error} = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}

// Chama uma Edge Function e devolve a mensagem de erro do corpo, quando houver.
export async function callFn(name, body){
  const {data, error} = await sb.functions.invoke(name, {body});
  if (error){
    let m = error.message;
    try { const j = await error.context.json(); if (j && j.error) m = j.error; } catch(e){}
    if (/Failed to send|fetch/i.test(m)) m = 'Não foi possível falar com o servidor. Tente de novo.';
    throw new Error(m);
  }
  return data;
}

export async function fetchAll(mk){
  let out = [], from = 0;
  for (;;){
    const {data, error} = await mk(from, from + 999);
    if (error) throw error;
    out = out.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}
