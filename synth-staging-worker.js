import worker from './synth-worker.js'
import { stagingWorker } from './staging-guard.js'

export default stagingWorker(worker)
