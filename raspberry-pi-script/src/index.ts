const Gpio = require('onoff').Gpio // Constructor function for Gpio objects.

console.log('Starting application...')
console.log('Initializing GPIO...')
const led = new Gpio(6, 'out')

console.log('LED on GPIO 6 (output)')

// Function to toggle LED state
function toggleLED() {
  led.read((err, value) => {
    if (err) {
      console.error('Error reading LED state:', err)
      return
    }
    led.write(value === 0 ? 1 : 0, (err) => {
      if (err) {
        console.error('Error writing to LED:', err)
      }
    })
  })
}

// Start blinking every 500ms
const blinkInterval = setInterval(toggleLED, 500)

process.on('SIGINT', () => {
  console.log('Cleaning up GPIO...')
  clearInterval(blinkInterval)
  led.unexport()
  process.exit()
})
