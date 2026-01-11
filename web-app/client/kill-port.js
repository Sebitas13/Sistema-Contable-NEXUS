const { exec } = require('child_process');
const port = process.argv[2];

if (!port) {
  console.error('Usage: node kill-port.js <port>');
  process.exit(1);
}

console.log(`Checking for processes using port ${port}...`);

// Ejecutar netstat para encontrar el PID del proceso usando el puerto
exec(`netstat -ano | findstr :${port}`, (error, stdout, stderr) => {
  if (error) {
    console.log(`No processes found using port ${port}`);
    return;
  }

  const lines = stdout.split('\n');
  const pids = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 5 && (parts[1].includes(`:${port}`) || parts[2].includes(`:${port}`))) {
      const pid = parts[parts.length - 1];
      if (pid && pid !== '0' && !pids.includes(pid)) {
        pids.push(pid);
      }
    }
  }

  if (pids.length === 0) {
    console.log(`No processes found using port ${port}`);
    return;
  }

  console.log(`Found processes using port ${port}: ${pids.join(', ')}`);

  // Matar cada proceso
  pids.forEach(pid => {
    console.log(`Killing process ${pid}...`);
    exec(`taskkill /PID ${pid} /F`, (killError, killStdout, killStderr) => {
      if (killError) {
        console.error(`Failed to kill process ${pid}:`, killError);
      } else {
        console.log(`Successfully killed process ${pid}`);
      }
    });
  });

  // Esperar un poco antes de continuar
  setTimeout(() => {
    console.log('Port should now be free.');
  }, 1000);
});
