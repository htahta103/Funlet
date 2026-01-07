const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function convertHtmlToPdf() {
    const htmlFile = path.join(__dirname, 'PATTERN_MATCHING_LOGGER_ANALYTICS_SUMMARY.html');
    const pdfFile = path.join(__dirname, 'PATTERN_MATCHING_LOGGER_ANALYTICS_SUMMARY.pdf');
    
    // Read HTML file
    const html = fs.readFileSync(htmlFile, 'utf8');
    
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Set content
    await page.setContent(html, {
        waitUntil: 'networkidle0'
    });
    
    console.log('Generating PDF...');
    await page.pdf({
        path: pdfFile,
        format: 'A4',
        margin: {
            top: '2cm',
            right: '2cm',
            bottom: '2cm',
            left: '2cm'
        },
        printBackground: true
    });
    
    await browser.close();
    
    console.log(`PDF created successfully: ${pdfFile}`);
}

convertHtmlToPdf().catch(console.error);













