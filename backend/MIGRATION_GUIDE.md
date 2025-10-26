# 🚀 Migration Guide - Step by Step

## Option 1: Cloud Database (Easiest - Recommended)

### Using Supabase (Free PostgreSQL)

1. **Sign up at https://supabase.com**
2. **Create a new project**
3. **Get your connection string** from Settings > Database
4. **Add to `.env`:**
```bash
DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT].supabase.co:5432/postgres"
USE_PRISMA=true
```

5. **Run migrations:**
```bash
cd QRovate/backend
npm run db:generate
npm run db:migrate
```

6. **Migrate your data:**
```bash
node scripts/migrate.js
```

Done! ✅

### Using Railway (Free PostgreSQL)

1. **Sign up at https://railway.app**
2. **Create PostgreSQL database**
3. **Copy connection string**
4. **Add to `.env`**
5. **Run migrations**

## Option 2: Install PostgreSQL Locally

### macOS:
```bash
# Install Homebrew first (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install PostgreSQL
brew install postgresql@15

# Start PostgreSQL
brew services start postgresql@15

# Create database
createdb qrovate
```

### Linux (Ubuntu/Debian):
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
createdb qrovate
```

### Windows:
1. Download from https://www.postgresql.org/download/windows/
2. Install PostgreSQL
3. Create database using pgAdmin

## Option 3: Keep Using JSON (Easiest for Now)

Your app works perfectly with JSON! Just run:
```bash
npm start
```

You can upgrade to PostgreSQL later when you're ready.

## 🔄 Migration Steps (Once PostgreSQL is Ready)

1. **Install dependencies (already done):**
```bash
npm install
```

2. **Generate Prisma client:**
```bash
npm run db:generate
```

3. **Run migrations:**
```bash
npm run db:migrate
```

4. **Migrate your data:**
```bash
node scripts/migrate.js
```

5. **Enable Prisma in `.env`:**
```bash
USE_PRISMA=true
DATABASE_URL="your-connection-string"
```

6. **Restart server:**
```bash
npm start
```

## ✅ Verifying Migration

After migration, check:
- Users are migrated ✅
- QR codes are migrated ✅
- Data is intact ✅

## 🐛 Troubleshooting

### "Cannot connect to database"
- Check PostgreSQL is running
- Verify connection string in `.env`
- Check firewall settings

### "Migration failed"
- Check your data.json is valid
- Verify database permissions
- Check logs for specific errors

## 📞 Need Help?

- Supabase: https://supabase.com/docs
- Railway: https://docs.railway.app
- PostgreSQL: https://www.postgresql.org/docs/


