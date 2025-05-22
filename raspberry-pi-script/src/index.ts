const Gpio = require('onoff').Gpio // Constructor function for Gpio objects.

console.log('Starting application...')
console.log('Initializing GPIO...')
const led = new Gpio(6, 'out')

console.log('LED on GPIO 6 (output)')

// Function to toggle LED state
function toggleLED() {
  try {
    const value = led.readSync()
    led.writeSync(value === 0 ? 1 : 0)
  } catch (err) {
    console.error('Error toggling LED:', err)
  }
}

// Start blinking every 500ms
const blinkInterval = setInterval(toggleLED, 500)

process.on('SIGINT', () => {
  console.log('Cleaning up GPIO...')
  clearInterval(blinkInterval)
  led.unexport()
  process.exit()
})
