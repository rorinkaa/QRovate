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
    "test@pro.com": { password: "test1234", isPro: true, trialEnds: null, stripeCustomerId: null, stripeSubId: null }
  },
  qrs: {}
};

function load() {
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify(defaultData, null, 2));
    return JSON.parse(JSON.stringify(defaultData));
  }
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf-8')); }
  catch (e) {
    fs.writeFileSync(dataFile, JSON.stringify(defaultData, null, 2));
    return JSON.parse(JSON.stringify(defaultData));
  }
}

let state = load();
function save(){ fs.writeFileSync(dataFile, JSON.stringify(state, null, 2)); }

export function getUser(email){ return state.users[email] || null; }
export function addUser(email, password){
  if(state.users[email]) return false;
  const trialEnds = now() + days(7);
  state.users[email] = { password, isPro:false, trialEnds, stripeCustomerId:null, stripeSubId:null };
  save(); return true;
}
export function setPro(email, val=true){
  const u = state.users[email]; if(!u) return false;
  u.isPro = !!val; if(val) u.trialEnds = null; save(); return true;
}
export function linkStripe(email, customerId, subId){
  const u = state.users[email]; if(!u) return false;
  if(customerId) u.stripeCustomerId = customerId;
  if(subId) u.stripeSubId = subId;
  save(); return true;
}
export function trialActive(email){
  const u = state.users[email]; if(!u) return false;
  if(u.isPro) return true;
  return typeof u.trialEnds==='number' && now() <= u.trialEnds;
}
export function trialDaysLeft(email){
  const u = state.users[email]; if(!u) return 0;
  if(u.isPro || u.trialEnds==null) return 0;
  const ms = u.trialEnds - now();
  return Math.max(0, Math.ceil(ms/(1000*60*60*24)));
}

export function listQR(owner){
  return Object.entries(state.qrs)
    .filter(([id,qr]) => qr.owner===owner)
    .map(([id,qr]) => ({ id, owner:qr.owner, target:qr.target, scanCount:qr.scanCount||0, blockedCount:qr.blockedCount||0, createdAt:qr.createdAt, lastScanAt:qr.lastScanAt||null }));
}
export function getQR(id){ return state.qrs[id] || null; }
export function createQR(owner, target){
  const id = (Date.now().toString(36)+Math.random().toString(36).slice(2,8));
  state.qrs[id] = { owner, target, scanCount:0, blockedCount:0, createdAt: now(), lastScanAt:null };
  save(); return { id, owner, target, scanCount:0, blockedCount:0 };
}
export function updateQR(id, owner, target){
  const qr = state.qrs[id]; if(!qr) return null; if(qr.owner!==owner) return false;
  qr.target = target; save(); return { id, owner, target, scanCount: qr.scanCount, blockedCount: qr.blockedCount };
}
export function recordScan(id, ok=true){
  const qr = state.qrs[id]; if(!qr) return;
  if(ok){ qr.scanCount=(qr.scanCount||0)+1; qr.lastScanAt=now(); }
  else { qr.blockedCount=(qr.blockedCount||0)+1; }
  save();
}
