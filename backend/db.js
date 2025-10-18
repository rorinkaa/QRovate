import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataFile = path.join(__dirname, 'data.json');

const now = () => Date.now();
const days = n => 1000 * 60 * 60 * 24 * n;

const defaultData = {
  users: {
    "test@pro.com": {
      password: "test1234",
      isPro: true,
      trialEnds: null,
      stripeCustomerId: null,
      stripeSubId: null,
      emailVerified: true
    }
  },
  qrs: {},
  verificationTokens: {},
  resetTokens: {}
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
if (!state.verificationTokens) state.verificationTokens = {};
if (!state.resetTokens) state.resetTokens = {};
function save(){ fs.writeFileSync(dataFile, JSON.stringify(state, null, 2)); }

const generateToken = () => crypto.randomBytes(32).toString('hex');
const VERIFICATION_TTL = days(2);
const RESET_TTL = days(1);

export function getUser(email){ return state.users[email] || null; }
export function addUser(email, password, passwordHash){
  if(state.users[email]) return false;
  const trialEnds = now() + days(7);
  state.users[email] = {
    password: password || null,
    passwordHash: passwordHash || null,
    isPro:false,
    trialEnds,
    stripeCustomerId:null,
    stripeSubId:null,
    emailVerified:false
  };
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
    .map(([id,qr]) => ({
      id,
      owner: qr.owner,
      name: qr.name || 'Untitled QR',
      target: qr.target,
      style: qr.style || null,
      scanCount: qr.scanCount || 0,
      blockedCount: qr.blockedCount || 0,
      createdAt: qr.createdAt,
      lastScanAt: qr.lastScanAt || null
    }));
}
export function getQR(id){ return state.qrs[id] || null; }
export function createQR(owner, target, style = null, name = 'Untitled QR') {
  const id = (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  state.qrs[id] = {
    owner,
    name,
    target,
    style: style || null,
    scanCount: 0,
    blockedCount: 0,
    createdAt: now(),
    lastScanAt: null,
    events: []
  };
  logEvent(state.qrs[id], { type: 'create' });
  save();
  return { id, owner, name, target, style: style || null, scanCount: 0, blockedCount: 0 };
}

export function updateQR(id, owner, target, style, name){
  const qr = state.qrs[id]; if(!qr) return null; if(qr.owner!==owner) return false;
  if (typeof name === 'string' && name.trim()) {
    qr.name = name.trim();
  }
  qr.target = target;
  if (style !== undefined) {
    qr.style = style || null;
  } else if (qr.style === undefined) {
    qr.style = null;
  }
  logEvent(qr, { type: 'update' });
  save();
  return { id, owner, name: qr.name || 'Untitled QR', target: qr.target, style: qr.style || null, scanCount: qr.scanCount, blockedCount: qr.blockedCount };
}
export function recordScan(id, ok=true){
  const qr = state.qrs[id]; if(!qr) return;
  if(ok){ qr.scanCount=(qr.scanCount||0)+1; qr.lastScanAt=now(); }
  else { qr.blockedCount=(qr.blockedCount||0)+1; }
  logEvent(qr, { type: 'scan', ok: !!ok });
  save();
}

function logEvent(qr, event){
  if(!qr) return;
  if(!Array.isArray(qr.events)) qr.events = [];
  qr.events.push({ ...event, ts: now() });
  if(qr.events.length > 120) qr.events = qr.events.slice(-120);
}

export function getEvents(id){
  const qr = getQR(id);
  if(!qr) return [];
  return Array.isArray(qr.events) ? [...qr.events] : [];
}

export function setPasswordHash(email, passwordHash) {
  if (!state.users[email]) return false;
  state.users[email].passwordHash = passwordHash;
  delete state.users[email].password;
  save();
  return true;
}

export function setEmailVerified(email, val = true) {
  const u = state.users[email]; if (!u) return false;
  u.emailVerified = !!val;
  save();
  return true;
}

export function createVerificationToken(email) {
  const u = state.users[email]; if (!u) return null;
  for (const [key, record] of Object.entries(state.verificationTokens)) {
    if (record.email === email) delete state.verificationTokens[key];
  }
  const token = generateToken();
  state.verificationTokens[token] = { email, expiresAt: now() + VERIFICATION_TTL };
  save();
  return token;
}

export function consumeVerificationToken(token) {
  const record = state.verificationTokens[token];
  if (!record) return null;
  delete state.verificationTokens[token];
  save();
  if (record.expiresAt && record.expiresAt < now()) return null;
  return record.email;
}

export function createResetToken(email) {
  const u = state.users[email]; if (!u) return null;
  for (const [key, record] of Object.entries(state.resetTokens)) {
    if (record.email === email) delete state.resetTokens[key];
  }
  const token = generateToken();
  state.resetTokens[token] = { email, expiresAt: now() + RESET_TTL };
  save();
  return token;
}

export function consumeResetToken(token) {
  const record = state.resetTokens[token];
  if (!record) return null;
  delete state.resetTokens[token];
  save();
  if (record.expiresAt && record.expiresAt < now()) return null;
  return record.email;
}
