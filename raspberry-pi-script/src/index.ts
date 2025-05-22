import { Gpio } from 'onoff'
const led = new Gpio(17, 'out')
const button = new Gpio(4, 'in', 'both')

button.watch((err, value) => led.writeSync(value))
