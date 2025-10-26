import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Normalize email for consistent lookups
function normalizeEmail(e) {
  return (e || '').toString().trim().toLowerCase();
}

// User functions
export async function getUser(email) {
  return await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
}

export async function addUser(email, password, passwordHash) {
  const existing = await getUser(email);
  if (existing) return false;
  
  const trialEnds = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  
  await prisma.user.create({
    data: {
      email: normalizeEmail(email),
      passwordHash,
      trialEnds,
      emailVerified: false
    }
  });
  
  return true;
}

export async function setPro(email, val = true) {
  const user = await getUser(email);
  if (!user) return false;
  
  await prisma.user.update({
    where: { email: normalizeEmail(email) },
    data: { 
      isPro: !!val,
      trialEnds: val ? null : user.trialEnds
    }
  });
  
  return true;
}

export async function linkStripe(email, customerId, subId) {
  const user = await getUser(email);
  if (!user) return false;
  
  await prisma.user.update({
    where: { email: normalizeEmail(email) },
    data: {
      stripeCustomerId: customerId || user.stripeCustomerId,
      stripeSubId: subId || user.stripeSubId
    }
  });
  
  return true;
}

export async function getUserByStripeCustomer(customerId) {
  if (!customerId) return null;
  return await prisma.user.findFirst({
    where: { stripeCustomerId: customerId }
  });
}

export async function trialActive(email) {
  const user = await getUser(email);
  if (!user) return false;
  if (user.isPro) return true;
  if (!user.trialEnds) return false;
  return Date.now() <= user.trialEnds.getTime();
}

export async function trialDaysLeft(email) {
  const user = await getUser(email);
  if (!user) return 0;
  if (user.isPro || !user.trialEnds) return 0;
  const ms = user.trialEnds.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export async function setPasswordHash(email, hash) {
  await prisma.user.update({
    where: { email: normalizeEmail(email) },
    data: { passwordHash: hash }
  });
}

export async function setEmailVerified(email, verified) {
  await prisma.user.update({
    where: { email: normalizeEmail(email) },
    data: { emailVerified: verified }
  });
}

export async function updateUserProfile(email, updates) {
  await prisma.user.update({
    where: { email: normalizeEmail(email) },
    data: updates
  });
  return true;
}

// Token functions
const generateToken = () => crypto.randomBytes(32).toString('hex');
const VERIFICATION_TTL = 2 * 24 * 60 * 60 * 1000;
const RESET_TTL = 24 * 60 * 60 * 1000;

export async function createVerificationToken(email) {
  const user = await getUser(email);
  if (!user) return null;
  
  const token = generateToken();
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL);
  
  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      token,
      expiresAt
    }
  });
  
  return token;
}

export async function consumeVerificationToken(token) {
  const tokenRecord = await prisma.verificationToken.findUnique({
    where: { token },
    include: { user: true }
  });
  
  if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
    return null;
  }
  
  await prisma.verificationToken.delete({ where: { id: tokenRecord.id } });
  return tokenRecord.user.email;
}

export async function createResetToken(email) {
  const user = await getUser(email);
  if (!user) return null;
  
  const token = generateToken();
  const expiresAt = new Date(Date.now() + RESET_TTL);
  
  await prisma.resetToken.create({
    data: {
      userId: user.id,
      token,
      expiresAt
    }
  });
  
  return token;
}

export async function consumeResetToken(token) {
  const tokenRecord = await prisma.resetToken.findUnique({
    where: { token },
    include: { user: true }
  });
  
  if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
    return null;
  }
  
  await prisma.resetToken.delete({ where: { id: tokenRecord.id } });
  return tokenRecord.user.email;
}

// QR Code functions
export async function getQR(id) {
  return await prisma.qRCode.findUnique({ where: { id } });
}

export async function createQR(owner, target, style = null, name = 'Untitled QR', options = {}) {
  const user = await getUser(owner);
  if (!user) throw new Error('User not found');
  
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  
  const qr = await prisma.qRCode.create({
    data: {
      id,
      ownerId: user.id,
      owner: { connect: { id: user.id } },
      name,
      target,
      style: style || {},
      password: options.password || null,
      expiresAt: options.expiresAt ? new Date(options.expiresAt) : null,
      scheduledStart: options.scheduledStart ? new Date(options.scheduledStart) : null,
      scheduledEnd: options.scheduledEnd ? new Date(options.scheduledEnd) : null,
      alternateTarget: options.alternateTarget || null
    }
  });
  
  return qr;
}

export async function createGuestQR(target, style = null, name = 'Guest QR') {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  
  const qr = await prisma.guestQR.create({
    data: {
      id,
      name,
      target,
      style: style || {}
    }
  });
  
  return qr;
}

export async function listQR(owner) {
  const user = await getUser(owner);
  if (!user) return [];
  
  const qrs = await prisma.qRCode.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: 'desc' }
  });
  
  return qrs.map(qr => ({
    id: qr.id,
    owner: owner,
    name: qr.name,
    target: qr.target,
    style: qr.style,
    scanCount: qr.scanCount,
    blockedCount: qr.blockedCount,
    createdAt: qr.createdAt.getTime(),
    lastScanAt: qr.lastScanAt?.getTime() || null,
    password: qr.password,
    expiresAt: qr.expiresAt?.getTime() || null,
    scheduledStart: qr.scheduledStart?.getTime() || null,
    scheduledEnd: qr.scheduledEnd?.getTime() || null,
    alternateTarget: qr.alternateTarget
  }));
}

export async function countUserQRCodes(owner) {
  const user = await getUser(owner);
  if (!user) return 0;
  return await prisma.qRCode.count({
    where: { ownerId: user.id }
  });
}

export async function updateQR(id, owner, target, style, name, options = {}) {
  const user = await getUser(owner);
  if (!user) return null;
  
  const qr = await getQR(id);
  if (!qr || qr.ownerId !== user.id) return null;
  
  const updateData = {
    target,
    style: style || {},
    name
  };
  
  if (options.password !== undefined) updateData.password = options.password;
  if (options.expiresAt !== undefined) updateData.expiresAt = options.expiresAt ? new Date(options.expiresAt) : null;
  if (options.scheduledStart !== undefined) updateData.scheduledStart = options.scheduledStart ? new Date(options.scheduledStart) : null;
  if (options.scheduledEnd !== undefined) updateData.scheduledEnd = options.scheduledEnd ? new Date(options.scheduledEnd) : null;
  if (options.alternateTarget !== undefined) updateData.alternateTarget = options.alternateTarget;
  
  const updated = await prisma.qRCode.update({
    where: { id },
    data: updateData
  });
  
  return updated;
}

export async function deleteQR(id, owner) {
  const user = await getUser(owner);
  if (!user) return false;
  
  const qr = await getQR(id);
  if (!qr || qr.ownerId !== user.id) return false;
  
  await prisma.qRCode.delete({ where: { id } });
  return true;
}

export async function recordScan(id, ok = true, analyticsData = {}) {
  const qr = await prisma.qRCode.findUnique({ where: { id } });
  if (!qr) return;
  
  const updateData = {
    scanCount: { increment: ok ? 1 : 0 },
    blockedCount: { increment: ok ? 0 : 1 }
  };
  
  if (ok) {
    updateData.lastScanAt = new Date();
  }
  
  await prisma.qRCode.update({
    where: { id },
    data: updateData
  });
  
  // Log event with analytics
  await prisma.event.create({
    data: {
      qrCodeId: id,
      type: 'scan',
      data: {
        success: ok,
        ...analyticsData
      }
    }
  });
}

export async function getEvents(qrId) {
  const events = await prisma.event.findMany({
    where: { qrCodeId: qrId },
    orderBy: { timestamp: 'desc' },
    take: 1000
  });
  
  return events.map(e => ({
    id: e.id,
    type: e.type,
    data: e.data,
    timestamp: e.timestamp.getTime()
  }));
}

// Static design functions
export async function listStaticDesigns(owner) {
  const user = await getUser(owner);
  if (!user) return [];
  
  const designs = await prisma.staticDesign.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: 'desc' }
  });
  
  return designs.map(d => ({
    id: d.id,
    name: d.name,
    template: d.template,
    values: d.values,
    style: d.style,
    payload: d.payload,
    createdAt: d.createdAt.getTime()
  }));
}

export async function createStaticDesign(owner, design) {
  const user = await getUser(owner);
  if (!user) throw new Error('User not found');
  
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  
  const created = await prisma.staticDesign.create({
    data: {
      id,
      ownerId: user.id,
      ...design
    }
  });
  
  return {
    id: created.id,
    ...created,
    createdAt: created.createdAt.getTime()
  };
}

export async function deleteStaticDesign(id, owner) {
  const user = await getUser(owner);
  if (!user) return false;
  
  const design = await prisma.staticDesign.findUnique({ where: { id } });
  if (!design || design.ownerId !== user.id) return false;
  
  await prisma.staticDesign.delete({ where: { id } });
  return true;
}

export default prisma;
