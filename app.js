// CommonJS-compatible Passenger startup file. Browser code is built separately.
import('./server.mjs').then(({ startServer }) => startServer()).catch((error) => {
  console.error('RTHtrack startup failed', error)
  process.exit(1)
})
