import net from 'net';
const s = new net.Socket();
s.setTimeout(5000);
s.connect(2345, '127.0.0.1', () => {
  console.log('Connected to 2345!');
  s.destroy();
  process.exit(0);
});
s.on('error', (e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
