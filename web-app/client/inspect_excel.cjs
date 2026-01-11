const XLSX = require('xlsx');
const path = require('path');

try {
    const filePath = path.resolve(__dirname, '..', '..', 'PUCT', 'puct.xlsx');
    console.log(`Leyendo archivo desde: ${filePath}`);

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Get top 20 rows as JSON
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', range: 'A1:J20' });

    console.log('--- Contenido de las primeras 20 filas de puct.xlsx ---');
    console.log(JSON.stringify(data, null, 2));
    console.log('--- Fin del contenido ---');

} catch (error) {
    console.error('Error al leer el archivo puct.xlsx:', error);
}
