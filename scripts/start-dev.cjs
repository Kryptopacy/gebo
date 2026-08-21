const { spawn } = require('child_process');

const child = spawn('npx', ['next', 'dev', '-p', '3001'], {
  shell: true,
  stdio: 'inherit'
});

child.on('error', (err) => {
  console.error('Failed to start Next dev:', err);
});
