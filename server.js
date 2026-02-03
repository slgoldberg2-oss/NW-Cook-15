const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Township mapping
// Note: Excel files are specific to each township
// Example: 2025_T24_PublicModel.xlsx is for Niles Township (Township 24)
const TOWNSHIPS = {
    'norwood-park': { name: 'Norwood Park', number: 26 },
    'evanston': { name: 'Evanston', number: 17 },
    'new-trier': { name: 'New Trier', number: 23 },
    'elk-grove': { name: 'Elk Grove', number: 16 },
    'maine': { name: 'Maine', number: 22 },
    'northfield': { name: 'Northfield', number: 25 },
    'barrington': { name: 'Barrington', number: 10 },
    'leyden': { name: 'Leyden', number: 20 },
    'wheeling': { name: 'Wheeling', number: 38 },
    'palatine': { name: 'Palatine', number: 29 },
    'schaumburg': { name: 'Schaumburg', number: 35 },
    'niles': { name: 'Niles', number: 24 },
    'hanover': { name: 'Hanover', number: 18 }
};

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Main scraping endpoint
app.post('/api/analyze', async (req, res) => {
    try {
        const { pins, township, year, taxRate, eqFactor } = req.body;

        console.log(`\n[${new Date().toISOString()}] Starting analysis`);
        console.log(`PINs: ${pins ? pins.join(', ') : 'none'}`);
        console.log(`Township: ${township}`);
        console.log(`Year: ${year}`);
        console.log(`Tax Rate: ${taxRate}%`);
        console.log(`EQ Factor: ${eqFactor}`);

        // Validate PINs array
        if (!pins || !Array.isArray(pins) || pins.length === 0) {
            return res.status(400).json({ error: 'Please provide at least one PIN' });
        }

        const townshipInfo = TOWNSHIPS[township];
        if (!townshipInfo) {
            return res.status(400).json({ error: 'Invalid township' });
        }

        // Variables to accumulate data from all PINs
        let totalCurrentMV = 0;
        let totalCurrentAV = 0;
        const pinResults = [];
        const allValuationTables = [];

        // Process each PIN
        for (const pin of pins) {
            const cleanPin = pin.replace(/-/g, '');
            
            if (cleanPin.length !== 14 || !/^\d{14}$/.test(cleanPin)) {
                return res.status(400).json({ error: `Invalid PIN format: ${pin}` });
            }

            console.log(`\n=== Processing PIN: ${formatPIN(cleanPin)} ===`);

            // Step 1: Get most recent assessment from Cook County API
            console.log('\n--- Fetching Most Recent Assessment from API ---');
            
            const apiUrl = `https://datacatalog.cookcountyil.gov/resource/uzyt-m557.json?pin=${cleanPin}&$order=year DESC&$limit=1`;
            console.log(`API URL: ${apiUrl}`);

            let currentAV = 0;
            let currentMV = 0;

        try {
            const apiResponse = await axios.get(apiUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json'
                },
                timeout: 15000,
                validateStatus: function (status) {
                    return status >= 200 && status < 500;
                }
            });

            if (apiResponse.status === 200) {
                const data = apiResponse.data;
                console.log(`API returned ${Array.isArray(data) ? data.length : 0} records`);
                
                if (data && Array.isArray(data) && data.length > 0) {
                    const record = data[0];
                    console.log(`Most Recent Record: Year=${record.year}, PIN=${record.pin}`);
                    
                    // Use board_tot if available (final after BOR), otherwise certified_tot, otherwise mailed_tot
                    if (record.board_tot) {
                        currentAV = parseInt(record.board_tot);
                        console.log(`✅ Using Board Assessment (BOR Certified): $${currentAV.toLocaleString()}`);
                    } else if (record.certified_tot) {
                        currentAV = parseInt(record.certified_tot);
                        console.log(`✅ Using Certified Assessment (Assessor Certified): $${currentAV.toLocaleString()}`);
                    } else if (record.mailed_tot) {
                        currentAV = parseInt(record.mailed_tot);
                        console.log(`✅ Using Mailed Assessment (Assessor Original): $${currentAV.toLocaleString()}`);
                    } else {
                        console.warn('⚠️ No assessment values found in API response');
                    }
                    
                    // Estimate market value using typical 10% assessment level for Class 2 (apartments)
                    currentMV = currentAV * 10;
                    console.log(`   Estimated Market Value: $${currentMV.toLocaleString()} (using 10% assessment level)`);
                    console.log(`   Township: ${record.township_name || 'N/A'}`);
                    console.log(`   Class: ${record.class || 'N/A'}`);
                } else {
                    console.warn(`⚠️ No data found for PIN ${cleanPin}`);
                }
            } else {
                console.warn(`API returned status ${apiResponse.status}`);
            }

        } catch (error) {
            console.error('Error fetching assessment data from API:', error.message);
            console.warn('Continuing with assessment value = 0');
        }

        totalCurrentMV += currentMV;
        totalCurrentAV += currentAV;

        // No reassessment data needed - removed API call

        pinResults.push({
            pin: formatPIN(cleanPin),
            current: { marketValue: currentMV, assessedValue: currentAV }
        });

        // Small delay between PINs
        if (pins.indexOf(pin) < pins.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    } // End of PIN loop

    console.log(`\n=== TOTALS FOR ALL PINs ===`);
    console.log(`Total Current MV: $${totalCurrentMV.toLocaleString()}`);
    console.log(`Total Current AV: $${totalCurrentAV.toLocaleString()}`);

    // Step 3: Download and parse Excel file (use first PIN for lookup)
    const firstPin = pins[0].replace(/-/g, '');
    console.log(`\n=== Downloading Valuation Worksheet ===`);
    console.log(`Looking for PIN: ${formatPIN(firstPin)} in Excel`);
        
        // Try multiple URL patterns
        const excelUrls = [
            `https://prodassets.cookcountyassessoril.gov/s3fs-public/reports/${year}.T${townshipInfo.number}.PublicModel.xlsx`,
            `https://prodassets.cookcountyassessoril.gov/s3fs-public/reports/${year}-T${townshipInfo.number}-PublicModel.xlsx`,
            `https://www.cookcountyassessoril.gov/sites/default/files/valuation-reports/${year}.T${townshipInfo.number}.PublicModel.xlsx`
        ];

        let valuationTable = null;
        let excelError = null;

        for (let i = 0; i < excelUrls.length; i++) {
            const excelUrl = excelUrls[i];
            console.log(`Attempt ${i + 1}: ${excelUrl}`);

            try {
                const excelResponse = await axios.get(excelUrl, {
                    responseType: 'arraybuffer',
                    timeout: 30000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    }
                });

                console.log('✅ Excel file downloaded successfully!');
                console.log(`File size: ${excelResponse.data.length} bytes`);
                
                const workbook = XLSX.read(excelResponse.data, { type: 'buffer' });
                console.log(`Available sheets: ${workbook.SheetNames.join(', ')}`);
                
                // Property type sheets to search
                const propertySheets = ['Multifamily', 'Hotels', 'Industrials', 'Comm517', 
                                       'NursingHomes', 'GasStations', 'Specials', 'Condos'];
                
                let headerRow = null;
                let pinRow = null;
                let foundSheet = null;

                // Search across all property sheets
                for (const sheetName of propertySheets) {
                    if (!workbook.SheetNames.includes(sheetName)) {
                        continue;
                    }
                    
                    console.log(`\nSearching in '${sheetName}' sheet...`);
                    const worksheet = workbook.Sheets[sheetName];
                    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                    
                    if (data.length === 0) continue;
                    
                    // First row is header
                    headerRow = data[0];
                    console.log(`  Header columns: ${headerRow.length}`);
                    console.log(`  Total rows: ${data.length}`);
                    
                    // Search for PIN in column 1 (KeyPIN)
                    for (let j = 1; j < data.length; j++) {
                        const row = data[j];
                        
                        if (!row || row.length === 0) continue;
                        
                        // Column 1 is KeyPIN
                        const keyPin = row[0];
                        
                        if (keyPin !== null && keyPin !== undefined) {
                            const keyPinStr = keyPin.toString().trim();
                            const keyPinClean = keyPinStr.replace(/[-\s]/g, '');
                            
                            // Check if this is our PIN
                            if (keyPinClean === firstPin || keyPinStr === formatPIN(firstPin)) {
                                pinRow = row;
                                foundSheet = sheetName;
                                console.log(`✅ Found PIN at row ${j + 1} in '${sheetName}'`);
                                console.log(`   KeyPIN value: "${keyPinStr}"`);
                                break;
                            }
                        }
                    }
                    
                    if (pinRow) break; // Found it, stop searching
                }

                if (headerRow && pinRow) {
                    // Create inverted table (transpose)
                    valuationTable = [];
                    
                    // Format values based on field type
                    const formatValue = (fieldName, value) => {
                        if (value === null || value === undefined || value === '') {
                            return '';
                        }
                        
                        const field = fieldName.toString().toLowerCase();
                        const val = value.toString().trim();
                        
                        // Dollar amount fields (rounded to nearest dollar)
                        if (field.includes('adjusted pgi') || 
                            field === 'pgi' ||
                            field.includes('est. pgi') ||
                            field.includes('egi') || 
                            field.includes('noi') ||
                            field.includes('final mv / unit') ||
                            field.includes('market value')) {
                            // Try to parse as number and format with commas (no decimals)
                            const num = parseFloat(val.replace(/[^0-9.-]/g, ''));
                            if (!isNaN(num)) {
                                return '$' + Math.round(num).toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0});
                            }
                        }
                        
                        // Percentage fields
                        if (field.includes('v/c') || 
                            field.includes('% exp') ||
                            field.includes('cap rate')) {
                            // Try to parse as number
                            const num = parseFloat(val);
                            if (!isNaN(num)) {
                                // If already a decimal (e.g., 0.05), convert to percentage
                                if (num < 1) {
                                    return (num * 100).toFixed(2) + '%';
                                } else {
                                    return num.toFixed(2) + '%';
                                }
                            }
                        }
                        
                        // Return original value for other fields
                        return val;
                    };
                    
                    for (let k = 0; k < Math.min(headerRow.length, pinRow.length); k++) {
                        const field = headerRow[k];
                        const value = pinRow[k];
                        
                        if (field !== null && field !== undefined && field !== '') {
                            const formattedValue = formatValue(field, value);
                            valuationTable.push({
                                field: field.toString().trim(),
                                value: formattedValue
                            });
                        }
                    }

                    console.log(`✅ Created valuation table with ${valuationTable.length} fields from '${foundSheet}' sheet`);
                    break; // Success - exit URL loop
                    
                } else {
                    if (!headerRow) {
                        console.warn(`⚠️ Could not find header row in any sheet`);
                    }
                    if (!pinRow) {
                        console.warn(`⚠️ PIN not found in any sheet`);
                        console.warn(`   Tried PIN: ${firstPin} (no dashes)`);
                        console.warn(`   Tried PIN: ${formatPIN(firstPin)} (with dashes)`);
                        console.warn(`   Sheets searched: ${propertySheets.join(', ')}`);
                    }
                    excelError = 'PIN not found in valuation worksheet';
                }

            } catch (error) {
                console.error(`❌ Attempt ${i + 1} failed: ${error.message}`);
                excelError = error.message;
                
                if (error.response) {
                    console.error(`   Status: ${error.response.status}`);
                    console.error(`   Status Text: ${error.response.statusText}`);
                }
                
                // Continue to next URL
                continue;
            }
        }

        if (!valuationTable) {
            console.warn('\n⚠️ Could not access valuation worksheet');
            console.warn(`Last error: ${excelError}`);
            console.warn('Report will be generated without valuation table');
        }

        // Calculate taxes using current assessment only
        // Formula: Assessment × (Tax Rate / 100) × Equalization Factor
        const currentTaxes = Math.round(totalCurrentAV * (taxRate / 100) * eqFactor);

        // Calculate level of assessment (AV / MV) for use in reassessment calculations
        const levelOfAssessment = totalCurrentMV > 0 ? (totalCurrentAV / totalCurrentMV) : 0.10;

        console.log(`\n=== Tax Calculation ===`);
        console.log(`Formula: Assessment × (Tax Rate / 100) × EQ Factor`);
        console.log(`Current: $${totalCurrentAV.toLocaleString()} × ${taxRate}% × ${eqFactor} = $${currentTaxes.toLocaleString()}`);
        console.log(`Level of Assessment: ${(levelOfAssessment * 100).toFixed(2)}%`);

        res.json({
            success: true,
            pins: pinResults,
            township: townshipInfo.name,
            year: year,
            taxRate: taxRate,
            eqFactor: eqFactor,
            current: {
                marketValue: totalCurrentMV,
                assessedValue: totalCurrentAV,
                estimatedTaxes: currentTaxes,
                levelOfAssessment: levelOfAssessment
            },
            valuationTable: valuationTable
        });

    } catch (error) {
        console.error('Analysis error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Format PIN with dashes
function formatPIN(pin) {
    if (pin.length !== 14) return pin;
    return `${pin.slice(0, 2)}-${pin.slice(2, 4)}-${pin.slice(4, 7)}-${pin.slice(7, 10)}-${pin.slice(10, 14)}`;
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('╔════════════════════════════════════════════════╗');
    console.log('║  Valuation Worksheet Analysis Running! 🚀     ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log('');
    console.log(`📡 Server running on port: ${PORT}`);
    console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    process.exit(0);
});
