import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as db from './db-prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataFile = path.join(__dirname, 'data.json');

async function migrate() {
  console.log('Starting migration from JSON to PostgreSQL...');
  
  if (!fs.existsSync(dataFile)) {
    console.log('No data.json file found. Skipping migration.');
    return;
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
    console.log('Loaded data.json');
    
    // Migrate users
    if (data.users) {
      console.log(`Migrating ${Object.keys(data.users).length} users...`);
      for (const [email, userData] of Object.entries(data.users)) {
        try {
          await db.addUser(email, userData.password, userData.passwordHash);
          if (userData.isPro) await db.setPro(email, true);
          if (userData.emailVerified) await db.setEmailVerified(email, true);
          if (userData.passwordHash) await db.setPasswordHash(email, userData.passwordHash);
          if (userData.stripeCustomerId || userData.stripeSubId) {
            await db.linkStripe(email, userData.stripeCustomerId, userData.stripeSubId);
          }
        } catch (e) {
          console.error(`Failed to migrate user ${email}:`, e.message);
        }
      }
      console.log('Users migrated successfully');
    }
    
    // Migrate QR codes
    if (data.qrs) {
      console.log(`Migrating ${Object.keys(data.qrs).length} QR codes...`);
      for (const [id, qrData] of Object.entries(data.qrs)) {
        try {
          const user = await db.getUser(qrData.owner);
          if (!user) {
            console.log(`Skipping QR ${id} - user ${qrData.owner} not found`);
            continue;
          }
          
          await db.createQR(
            qrData.owner,
            qrData.target || '',
            qrData.style || {},
            qrData.name || 'Untitled QR',
            {
              password: qrData.password,
              expiresAt: qrData.expiresAt,
              scheduledStart: qrData.scheduledStart,
              scheduledEnd: qrData.scheduledEnd,
              alternateTarget: qrData.alternateTarget
            }
          );
        } catch (e) {
          console.error(`Failed to migrate QR ${id}:`, e.message);
        }
      }
      console.log('QR codes migrated successfully');
    }
    
    // Migrate static designs
    if (data.staticDesigns) {
      console.log(`Migrating ${Object.keys(data.staticDesigns).length} static designs...`);
      for (const [id, designData] of Object.entries(data.staticDesigns)) {
        try {
          const user = await db.getUser(designData.owner);
          if (!user) {
            console.log(`Skipping static design ${id} - user ${designData.owner} not found`);
            continue;
          }
          
          await db.createStaticDesign(designData.owner, designData);
        } catch (e) {
          console.error(`Failed to migrate static design ${id}:`, e.message);
        }
      }
      console.log('Static designs migrated successfully');
    }
    
    console.log('Migration completed successfully!');
    console.log('Backup data.json before switching to PostgreSQL.');
    
  } catch (e) {
    console.error('Migration failed:', e);
    process.exit(1);
  }
}

migrate();


