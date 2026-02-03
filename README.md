# Cook County Valuation Worksheet Analysis Tool

## Overview
Analyzes income-producing properties across 13 North and Northwest Cook County townships using official valuation methodology worksheets.

## Features
- 13 Townships covered (Niles, Elk Grove, Evanston, etc.)
- 1,235+ properties across all property types
- Most recent assessment from Cook County API
- Professional PDF-ready reports
- Multiple PIN support

## Deployment to Railway

### Step 1: Upload to GitHub
1. Create new repository: `valuation-worksheet-analysis`
2. Upload these files:
   - package.json
   - server.js
   - index.html
   - Procfile
   - .gitignore

### Step 2: Deploy on Railway
1. Go to railway.app
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your repository
5. Railway will automatically:
   - Detect Node.js
   - Install dependencies from package.json
   - Start server using Procfile
6. Wait 2-3 minutes for build

### Step 3: Get Your URL
1. Go to Settings → Networking
2. Click "Generate Domain"
3. Your URL: `your-app-name.up.railway.app`

## Troubleshooting

### Build Fails
- Check Railway logs for errors
- Verify package.json has correct syntax
- Ensure Node.js version is 20.x

### Server Won't Start
- Check that PORT environment variable is set (Railway does this automatically)
- Verify all dependencies are in package.json
- Check Railway logs for startup errors

### API Errors
- Cook County API may be rate limited
- Excel files must be accessible from Cook County website
- Check that township codes are correct

## Testing
Test with these sample PINs:
- **Niles (T24):** 10-27-212-038-0000
- **Elk Grove (T16):** 08-07-203-012-0000
- **Evanston (T17):** Any PIN from Evanston

## Environment Variables
Railway automatically sets:
- `PORT` - Server port (don't set manually)

No other environment variables needed.

## Support
Check Railway deployment logs if issues occur.
