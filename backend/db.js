import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataFile = path.join(__dirname, 'data.json');

const now = () => Date.now();
const days = n => 1000 * 60 * 60 * 24 * n;

const defaultData = {
  users: {
    "test@pro.com": { passwordHash: null, isPro: true, trialEnds: null, stripeCustomerId: null, stripeSubId: null }
  },
  qrs: {}
};

let state = defaultData;
try{
  if(fs.existsSync(dataFile)){
    state = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
  }else{
    fs.writeFileSync(dataFile, JSON.stringify(defaultData, null, 2));
  }
}catch(e){
  console.error('DB init error', e);
}

function save(){
  fs.writeFileSync(dataFile, JSON.stringify(state, null, 2));
}

export function getUser(email){ return state.users[email] || null; }
export function addUser(email, _password, passwordHash){
  if(state.users[email]) return false;
  state.users[email] = { passwordHash: passwordHash || null, isPro:false, trialEnds: now()+days(7), stripeCustomerId:null, stripeSubId:null };
  save(); return true;
}
export function setPasswordHash(email, passwordHash){
  if(!state.users[email]) return false;
  state.users[email].passwordHash = passwordHash;
  delete state.users[email].password;
  save(); return true;
}
export function setPro(email, isPro=true){
  if(!state.users[email]) return false;
  state.users[email].isPro = !!isPro; save(); return true;
}
export function linkStripe(email, customerId, subId){
  if(!state.users[email]) return false;
  state.users[email].stripeCustomerId = customerId;
  state.users[email].stripeSubId = subId;
  save(); return true;
}
export function trialDaysLeft(email){
  const u = state.users[email]; if(!u) return 0;
  if(u.isPro) return 0;
  if(!u.trialEnds) return 0;
  return Math.max(0, Math.ceil((u.trialEnds - now())/days(1)));
}
export function trialActive(email){ return trialDaysLeft(email) > 0 || (state.users[email] && state.users[email].isPro); }

export function listQR(owner){
  const out = [];
  for(const [id, qr] of Object.entries(state.qrs)){
    if(qr.owner === owner){
      out.push({ id, owner: qr.owner, target: qr.target, scanCount: qr.scanCount||0, blockedCount: qr.blockedCount||0 });
    }
  }
  return out;
}
export function getQR(id){ return state.qrs[id] || null; }
export function createQR(owner, target){
  if(!owner) throw new Error('owner required');
  if(!target) throw new Error('target required');
  const isUrl = /^https?:\/\//i.test(target);
  if(!isUrl) throw new Error('target must be a valid http(s) URL');
  const id = (Date.now().toString(36)+Math.random().toString(36).slice(2,8));
  state.qrs[id] = { owner, target, scanCount:0, blockedCount:0, createdAt: now(), lastScanAt:null };
  save(); return { id, owner, target, scanCount:0, blockedCount:0 };
}
export function updateQR(id, owner, target){
  const qr = state.qrs[id]; if(!qr) return null; if(qr.owner!==owner) return false;
  const isUrl = /^https?:\/\//i.test(target);
  if(!isUrl) throw new Error('target must be a valid http(s) URL');
  qr.target = target; save(); return { id, owner, target, scanCount: qr.scanCount, blockedCount: qr.blockedCount };
}
export function recordScan(id, ok=true){
  const qr = state.qrs[id]; if(!qr) return;
  if(ok){ qr.scanCount=(qr.scanCount||0)+1; qr.lastScanAt=now(); }
  else { qr.blockedCount=(qr.blockedCount||0)+1; }
  save();
}
