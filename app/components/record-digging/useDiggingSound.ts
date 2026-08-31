'use client'

import { useRef } from 'react'

/** レコードを切り替える「シュッ」という短い音と、取り上げる「余韻のある」音を
 * Web Audio APIでその場合成する(外部音源ファイルは使わない)。AudioContextは
 * ブラウザの自動再生制約を避けるため、最初のplay*呼び出し時に遅延生成する。 */
export function useDiggingSound() {
  const ctxRef = useRef<AudioContext | null>(null)

  function getContext(): AudioContext {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext()
    }
    if (ctxRef.current.state === 'suspended') {
      ctxRef.current.resume()
    }
    return ctxRef.current
  }

  function makeNoiseBuffer(ctx: AudioContext, durationSeconds: number): AudioBuffer {
    const bufferSize = Math.floor(ctx.sampleRate * durationSeconds)
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize)
    }
    return buffer
  }

  function playFlip() {
    const ctx = getContext()
    const duration = 0.08

    const source = ctx.createBufferSource()
    source.buffer = makeNoiseBuffer(ctx, duration)

    const filter = ctx.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = 2000

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.5, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)

    source.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    source.start()
  }

  function playPickup() {
    const ctx = getContext()
    const duration = 0.3

    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(200, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + duration)

    const oscGain = ctx.createGain()
    oscGain.gain.setValueAtTime(0.3, ctx.currentTime)
    oscGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)

    const noiseSource = ctx.createBufferSource()
    noiseSource.buffer = makeNoiseBuffer(ctx, 0.05)
    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0.2, ctx.currentTime)

    osc.connect(oscGain)
    oscGain.connect(ctx.destination)
    noiseSource.connect(noiseGain)
    noiseGain.connect(ctx.destination)

    osc.start()
    osc.stop(ctx.currentTime + duration)
    noiseSource.start()
  }

  return { playFlip, playPickup }
}
