import os from 'os';
export function resolveBaseUrl(){
  if(process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  // Prefer localhost for local development to avoid network issues
  return 'http://localhost:4000';
}
