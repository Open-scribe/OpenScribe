class PCMWorkletProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (input && input[0]) {
      const channelData = input[0]
      const copy = new Float32Array(channelData.length)
      copy.set(channelData)
      this.port.postMessage(copy, [copy.buffer])
    }
    return true
  }
}

registerProcessor("pcm-processor", PCMWorkletProcessor)
