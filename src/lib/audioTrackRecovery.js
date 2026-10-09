// Track-level recovery for audio capture. On some drivers/hotplug paths,
// MediaStreamTrack 'ended' occurs without a mediaDevices 'devicechange' event.
// This helper only observes audio tracks and never restarts capture itself.
export function watchAudioTrackEnded(mediaStream, onEnded) {
  const tracks = mediaStream?.getAudioTracks?.() || []
  let fired = false
  const subscriptions = []
  for (const track of tracks) {
    if (!track || typeof track.addEventListener !== 'function') continue
    const handler = () => {
      if (fired || track.readyState !== 'ended') return
      fired = true
      onEnded?.(track)
    }
    track.addEventListener('ended', handler)
    subscriptions.push([track, handler])
  }
  return () => {
    fired = true
    for (const [track, handler] of subscriptions) {
      track.removeEventListener?.('ended', handler)
    }
  }
}

export function shouldRecoverEndedTrack({
  expectedStream, activeStream, stopped, suspended,
} = {}) {
  return !!expectedStream && expectedStream === activeStream && !stopped && !suspended
}
