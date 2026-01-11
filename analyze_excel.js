const XLSX = require('xlsx');
const path = require('path');

try {
  const filePath = path.join('DataForge', 'Plan de Cuentas ASFI (1).xlsx');
  const workbook = XLSX.readFile(filePath);

  console.log('=== INFORMACIÓN DEL ARCHIVO EXCEL ===');
  console.log('Nombre del archivo:', filePath);
  console.log('Hojas disponibles:', workbook.SheetNames.length);
  console.log('Nombres de hojas:', workbook.SheetNames);

  // Analizar cada hoja
  workbook.SheetNames.forEach((sheetName, index) => {
    const worksheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

    console.log(`\n=== HOJA ${index + 1}: ${sheetName} ===`);
    console.log('Rango:', worksheet['!ref']);
    console.log('Filas:', range.e.r - range.s.r + 1);
    console.log('Columnas:', range.e.c - range.s.c + 1);

    // Mostrar primeras 5 filas
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    console.log('Primeras 5 filas:');
    data.slice(0, 5).forEach((row, i) => {
      console.log(`  Fila ${i + 1}:`, row.slice(0, 5)); // Solo primeras 5 columnas
    });

    // Verificar si hay datos reales
    const nonEmptyRows = data.filter(row => row.some(cell => cell !== null && cell !== undefined && cell !== ''));
    console.log('Filas no vacías:', nonEmptyRows.length);
  });

} catch (error) {
  console.error('Error leyendo el archivo:', error.message);
}
